import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PreviewContainer, type PreviewContainerHandle, type OpAppliedInfo } from "./components/PreviewContainer";
import { Inspector } from "./components/Inspector";
import { FloatingPanel } from "./components/FloatingPanel";
import { onExtensionMessage, postToExtension } from "./bridge";
import { ackPendingStyles, buildStylePersistMessage, type PendingStyleEdit } from "./persistContract";
import { resolveTailwindClassList, styleToUtilities } from "@design-studio/shared/tailwind";
import { translate, type Language } from "@design-studio/shared/i18n";
import type { EditableAttribute, ElementOp, ElementPayload, PreviewStateMessage } from "./types";
import type { DesignEdit } from "../src/domain/entities/DesignEdit";
import styles from "./App.module.css";

interface PendingStyleRequest {
  requestId: string;
  sessionId: string;
  selector?: string;
  property: string;
  value: string;
  previousValue: string;
  timeoutId: number;
}

export function App(): React.ReactElement {
  const [state, setState] = useState<Partial<PreviewStateMessage>>({ url: "", status: "idle", language: "ru" });
  const [selected, setSelected] = useState<ElementPayload | null>(null);
  const [pendingStyles, setPendingStyles] = useState<PendingStyleEdit[]>([]);
  const [edits, setEdits] = useState<DesignEdit[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [operationStatus, setOperationStatus] = useState("");

  const previewRef = useRef<PreviewContainerHandle | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingStyleRequest>>(new Map());
  const persistSeqRef = useRef(0);
  const selectedRef = useRef<ElementPayload | null>(null);
  const previousClassesRef = useRef<string[] | undefined>(undefined);
  const language: Language = state.language === "en" ? "en" : "ru";
  const languageRef = useRef<Language>(language);
  languageRef.current = language;
  selectedRef.current = selected;

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, "toolbar.title");
  }, [language]);

  const clearPending = () => {
    for (const pending of pendingRequestsRef.current.values()) window.clearTimeout(pending.timeoutId);
    pendingRequestsRef.current.clear();
  };

  // WV-01: the selection and the edit journal are valid for one document route.
  const resetSessionEdits = useCallback(() => {
    setSelected(null);
    setPendingStyles([]);
    setEdits([]);
    setStyleError("");
  }, []);
  const lastRouteRef = useRef<string | null>(null);

  const recordEdit = (edit: DesignEdit) => {
    setEdits((previous) => {
      const replaceable = edit.kind === "style" || edit.kind === "classes" || edit.kind === "text" || edit.kind === "attribute";
      if (!replaceable) return [...previous, edit];
      const key = (candidate: DesignEdit) => `${candidate.kind}:${candidate.selector}:${candidate.property ?? ""}`;
      const existingIndex = previous.findIndex((candidate) => key(candidate) === key(edit));
      if (existingIndex === -1) return [...previous, edit];
      const next = [...previous];
      next[existingIndex] = { ...edit, before: previous[existingIndex].before };
      return next;
    });
  };

  useEffect(() => {
    postToExtension({ type: "preview:ready" });
    return onExtensionMessage((raw) => {
      const msg = raw as {
        type?: string;
        message?: string;
        success?: boolean;
        file?: string;
      } & Partial<PreviewStateMessage>;
      if (msg.type === "preview:state") {
        setState({
          url: msg.url,
          status: msg.status,
          projectRoot: msg.projectRoot,
          projectEntry: msg.projectEntry,
          projectEntries: msg.projectEntries,
          devServer: msg.devServer,
          devServerSuggestions: msg.devServerSuggestions,
          language: msg.language === "en" ? "en" : "ru",
        });
      } else if (msg.type === "preview:error") {
        setState((current) => ({ ...current, status: "error" }));
        setOperationStatus(msg.message ?? translate(languageRef.current, "status.previewError"));
      } else if (msg.type === "persist:result") {
        // P0-4: drop only the acknowledged edit; failed/unconfirmed edits stay.
        setPendingStyles((current) => ackPendingStyles(current, msg));
        setOperationStatus(msg.message ?? "");
      } else if (msg.type === "ai:result" || msg.type === "ai:componentResult") {
        setOperationStatus(msg.message ?? "");
      } else if (msg.type === "error") {
        setOperationStatus(translate(languageRef.current, "status.extensionError", { error: msg.message ?? "" }));
      }
    });
  }, []);

  useEffect(() => {
    clearPending();
    resetSessionEdits();
    lastRouteRef.current = null;
  }, [state.url]);

  const handleChange = (property: string, value: string) => {
    const current = selectedRef.current;
    if (current?.tailwind === true) {
      const utilities = styleToUtilities(property, value);
      if (utilities !== null) {
        previousClassesRef.current = current.classes ? [...current.classes] : [];
        applyOp("set-classes", resolveTailwindClassList(current.classes ?? [], utilities).join(" "));
        return;
      }
    }
    const result = previewRef.current?.applyStyle(property, value) ?? null;
    if (!result) {
      setStyleError(translate(language, "status.runtimeMissing"));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      if (!pendingRequestsRef.current.delete(result.requestId)) return;
      setStyleError(translate(language, "status.styleTimeout"));
      setOperationStatus(translate(language, "status.styleTimeout"));
    }, 5000);
    pendingRequestsRef.current.set(result.requestId, {
      requestId: result.requestId,
      sessionId: result.sessionId,
      selector: current?.selector,
      property,
      value,
      previousValue: current?.styles[property] ?? "",
      timeoutId,
    });
  };

  const handleStyleApplied = (info: {
    success: boolean;
    reason?: string;
    requestId?: string;
    sessionId?: string;
    property: string;
    value: string;
    payload?: ElementPayload;
  }) => {
    const requestId = info.requestId;
    if (!requestId) return;
    const pending = pendingRequestsRef.current.get(requestId);
    if (!pending || (info.sessionId && info.sessionId !== pending.sessionId)) return;
    window.clearTimeout(pending.timeoutId);
    pendingRequestsRef.current.delete(requestId);
    if (!info.success) {
      const message = info.reason ?? translate(language, "status.styleFailed");
      setStyleError(message);
      setOperationStatus(message);
      return;
    }

    setStyleError("");
    const payload = info.payload ?? selectedRef.current ?? undefined;
    if (payload) {
      setSelected((previous) => ({ ...payload, styles: { ...previous?.styles, ...payload.styles, [info.property]: info.value } }));
      const component = payload.component?.[0];
      if (payload.selector) {
        recordEdit({
          kind: "style",
          selector: payload.selector,
          property: info.property,
          before: pending.previousValue,
          after: info.value,
          component: component ? { name: component.name, file: component.file, line: component.line } : undefined,
        });
        setPendingStyles((previous) => [
          ...previous.filter((item) => !(item.selector === payload.selector && item.property === info.property)),
          {
            requestId: `persist-${++persistSeqRef.current}`,
            selector: payload.selector,
            selectors: payload.selectors,
            property: info.property,
            value: info.value,
            sourceRules: payload.rules,
          },
        ]);
        setOperationStatus(translate(language, "status.styleApplied"));
      }
    }
  };

  const applyOp = (op: ElementOp, value?: string, attribute?: EditableAttribute) => {
    if (op === "set-classes" && selectedRef.current && previousClassesRef.current === undefined) {
      previousClassesRef.current = [...(selectedRef.current.classes ?? [])];
    }
    const result = previewRef.current?.applyOp(op, value, attribute) ?? null;
    if (!result) setStyleError(translate(language, "status.runtimeMissing"));
  };

  const handleOpApplied = (info: OpAppliedInfo) => {
    if (!info.success) {
      setOperationStatus(info.reason ?? translate(language, "status.operationFailed"));
      return;
    }
    const payload = info.payload ?? selectedRef.current;
    setSelected(payload ?? null);
    if (!payload?.selector) return;
    const component = payload.component?.[0];
    const componentRef = component ? { name: component.name, file: component.file, line: component.line } : undefined;
    if (info.op === "set-classes") {
      const before = (previousClassesRef.current ?? selectedRef.current?.classes ?? []).join(" ");
      const after = (info.value ?? "").split(/\s+/).filter(Boolean).join(" ");
      recordEdit({ kind: "classes", selector: payload.selector, before, after, component: componentRef });
      previousClassesRef.current = undefined;
      setOperationStatus(translate(language, "status.classesApplied"));
      return;
    }
    if (info.op === "set-text") {
      recordEdit({ kind: "text", selector: payload.selector, before: selectedRef.current?.text ?? "", after: info.value ?? payload.text ?? "", component: componentRef });
      setOperationStatus(translate(language, "status.textApplied"));
      return;
    }
    if (info.op === "set-attribute") {
      const name = info.attribute;
      if (!name) return;
      recordEdit({
        kind: "attribute",
        selector: payload.selector,
        property: name,
        before: selectedRef.current?.attributes?.[name] ?? "",
        after: info.value ?? payload.attributes?.[name] ?? "",
        component: componentRef,
      });
      setOperationStatus(translate(language, "status.attributeApplied"));
      return;
    }
    recordEdit({ kind: "structure", selector: payload.selector, operation: info.op, component: componentRef });
    setOperationStatus(translate(language, "status.operationApplied"));
  };

  const handleSave = () => {
    if (pendingStyles.length === 0) {
      setOperationStatus(translate(language, "status.noEdits"));
      return;
    }
    for (const edit of pendingStyles) postToExtension(buildStylePersistMessage(edit));
    setOperationStatus(translate(language, "status.saving"));  };

  const handleCopyInstruction = (instruction: string) => {
    if (!selected && !instruction.trim() && edits.length === 0) {
      setOperationStatus(translate(language, "status.noSelection"));
      return;
    }
    postToExtension({ type: "ai:copyInstruction", ...(selected ? { payload: selected } : {}), instruction, edits });
  };

  const handlePreviewNavigate = (url: string) => {
    clearPending();
    postToExtension({ type: "project:navigate", url });
  };

  const handlePreviewLocationChange = (path: string) => {
    // WV-01: ds:navigate also arrives on set-mode with an unchanged path;
    // only a real route change clears the session edit journal.
    if (lastRouteRef.current !== null && lastRouteRef.current !== path) resetSessionEdits();
    lastRouteRef.current = path;
    postToExtension({ type: "project:rememberNavigation", path });
  };

  const handleNavigateBlocked = (url: string) => {
    setOperationStatus(translate(language, "status.externalLinkBlocked", { url }));
  };

  const handleCopyComponent = (component: { name?: string; file?: string; line?: number }) => {
    postToExtension({ type: "ai:copyComponent", component });
  };

  const handleRevealSource = (components: { name?: string; file?: string; line?: number }[]) => {
    postToExtension({ type: "source:reveal", components });
  };

  const handleLanguageChange = (nextLanguage: Language) => {
    setState((current) => ({ ...current, language: nextLanguage }));
    postToExtension({ type: "ui:setLanguage", language: nextLanguage });
  };

  return (
    <div className={styles.root}>
      <Toolbar
        projectRoot={state.projectRoot}
        projectEntry={state.projectEntry}
        projectEntries={state.projectEntries}
        devServer={state.devServer}
        devServerSuggestions={state.devServerSuggestions}
        editMode={editMode}
        language={language}
        onLanguageChange={handleLanguageChange}
        onInspect={() => setEditMode((value) => !value)}
        onSave={handleSave}
        canSave={pendingStyles.length > 0}
      />
      <div className={styles.content}>
        <PreviewContainer
          ref={previewRef}
          url={state.url ?? ""}
          status={state.status ?? "idle"}
          language={language}
          editMode={editMode}
          onEditModeChange={setEditMode}
          devServer={state.devServer}
          onNavigate={handlePreviewNavigate}
          onLocationChange={handlePreviewLocationChange}
          onNavigateBlocked={handleNavigateBlocked}
          onRevealSource={handleRevealSource}
          onCopyInstruction={handleCopyInstruction}
          onRefresh={clearPending}
          onSelect={setSelected}
          onStyleApplied={handleStyleApplied}
          onOpApplied={handleOpApplied}
        />
        <Inspector
          selected={selected}
          language={language}
          onApplyStyle={handleChange}
          onApplyOp={applyOp}
          onEditText={(text) => applyOp("set-text", text)}
          onCopyComponent={handleCopyComponent}
          error={styleError}
        />
      </div>
      <FloatingPanel selected={selected} status={operationStatus} edits={edits} language={language} onCopyInstruction={handleCopyInstruction} />
    </div>
  );
}
