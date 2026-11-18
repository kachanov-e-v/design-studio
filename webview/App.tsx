import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PreviewContainer, type PreviewContainerHandle, type OpAppliedInfo } from "./components/PreviewContainer";
import { Inspector } from "./components/Inspector";
import { FloatingPanel } from "./components/FloatingPanel";
import { onExtensionMessage, postToExtension } from "./bridge";
import { ackPendingStyles, buildStylePersistMessage, type PendingStyleEdit } from "./persistContract";
import { resolveTailwindClassList, styleToUtilities } from "@design-studio/shared/tailwind";
import { primaryComponent } from "./componentInfo";
import { translate, type Language } from "@design-studio/shared/i18n";
import type { ReplayEdit } from "@design-studio/preview-runtime/protocol";
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

const EDIT_KINDS = new Set(["style", "text", "classes", "attribute", "structure", "comment"]);
const JOURNAL_SAVE_DEBOUNCE_MS = 500;

/** IMP-A: journal entries the runtime can re-apply by selector after reload/HMR. */
function toReplayEdits(list: DesignEdit[]): ReplayEdit[] {
  const replay: ReplayEdit[] = [];
  for (const edit of list) {
    if (edit.kind !== "style" && edit.kind !== "text" && edit.kind !== "classes" && edit.kind !== "attribute") continue;
    if (edit.after === undefined) continue;
    replay.push({
      kind: edit.kind,
      selector: edit.selector,
      ...(edit.kind === "style" || edit.kind === "attribute" ? { property: edit.property } : {}),
      value: edit.after,
    });
  }
  return replay;
}

/** Minimal shape check for a journal restored from extension storage. */
function sanitizeLoadedEdits(value: unknown): DesignEdit[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DesignEdit =>
      Boolean(item) &&
      typeof item === "object" &&
      EDIT_KINDS.has((item as DesignEdit).kind) &&
      typeof (item as DesignEdit).selector === "string"
  );
}

export function App(): React.ReactElement {
  const [state, setState] = useState<Partial<PreviewStateMessage>>({ url: "", status: "idle", language: "ru" });
  const [selected, setSelected] = useState<ElementPayload | null>(null);
  const [pendingStyles, setPendingStyles] = useState<PendingStyleEdit[]>([]);
  const [edits, setEdits] = useState<DesignEdit[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [operationStatus, setOperationStatus] = useState("");
  const [toastSeq, setToastSeq] = useState(0);
  const notify = useCallback((message: string) => {
    setOperationStatus(message);
    setToastSeq((seq) => seq + 1);
  }, []);
  const [instruction, setInstruction] = useState("");
  const [popupDrafts, setPopupDrafts] = useState<Record<string, string>>({});
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);

  const previewRef = useRef<PreviewContainerHandle | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingStyleRequest>>(new Map());
  const persistSeqRef = useRef(0);
  const selectedRef = useRef<ElementPayload | null>(null);
  const previousClassesRef = useRef<string[] | undefined>(undefined);
  const editsRef = useRef<DesignEdit[]>([]);
  const language: Language = state.language === "en" ? "en" : "ru";
  const languageRef = useRef<Language>(language);
  languageRef.current = language;
  selectedRef.current = selected;
  editsRef.current = edits;

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
    setInstruction("");
    setPopupDrafts({});
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
        path?: string;
        edits?: unknown;
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
        notify(msg.message ?? translate(languageRef.current, "status.previewError"));
      } else if (msg.type === "preview:csp-fallback") {
        notify(translate(languageRef.current, "status.cspFallback"));
      } else if (msg.type === "persist:result") {
        // P0-4: drop only the acknowledged edit; failed/unconfirmed edits stay.
        setPendingStyles((current) => ackPendingStyles(current, msg));
        notify(msg.message ?? "");
      } else if (msg.type === "ai:result" || msg.type === "ai:componentResult") {
        notify(msg.message ?? "");
      } else if (msg.type === "error") {
        notify(translate(languageRef.current, "status.extensionError", { error: msg.message ?? "" }));
      } else if (msg.type === "journal:loaded") {
        // IMP-A: restore only into an empty journal for the current route —
        // a late load must never clobber live edits.
        if (msg.path !== lastRouteRef.current || editsRef.current.length > 0) return;
        const loaded = sanitizeLoadedEdits(msg.edits);
        if (loaded.length === 0) return;
        setEdits(loaded);
        const selectors = new Set(loaded.map((edit) => edit.selector));
        for (const selector of selectors) previewRef.current?.markElement(selector, true);
        // The runtime may already be ready; if not, handleRuntimeReady replays
        // later — applying the same values twice is idempotent.
        const replay = toReplayEdits(loaded);
        if (replay.length > 0) previewRef.current?.replayEdits(replay);
      }
    });
  }, [notify]);

  useEffect(() => {
    clearPending();
    resetSessionEdits();
    lastRouteRef.current = null;
  }, [state.url, resetSessionEdits]);

  // IMP-A: persist the journal (debounced) so a window reload can restore it.
  useEffect(() => {
    if (lastRouteRef.current === null) return;
    const timer = window.setTimeout(() => {
      if (lastRouteRef.current !== null) {
        postToExtension({ type: "journal:save", path: lastRouteRef.current, edits });
      }
    }, JOURNAL_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [edits]);

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
      setStyleError(translate(languageRef.current, "status.styleTimeout"));
      notify(translate(languageRef.current, "status.styleTimeout"));
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
      notify(message);
      return;
    }

    setStyleError("");
    const payload = info.payload ?? selectedRef.current ?? undefined;
    if (payload) {
      // A late apply for a previously selected element must not overwrite the
      // current selection's payload.
      if (payload.selector === selectedRef.current?.selector) {
        setSelected((previous) => ({ ...payload, styles: { ...previous?.styles, ...payload.styles, [info.property]: info.value } }));
      }
      const component = primaryComponent(payload.component);
      if (payload.selector) {
        previewRef.current?.markElement(payload.selector, true);
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
        notify(translate(language, "status.styleApplied"));
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
      if (info.op === "set-classes") previousClassesRef.current = undefined;
      notify(info.reason ?? translate(language, "status.operationFailed"));
      return;
    }
    const payload = info.payload ?? selectedRef.current;
    setSelected(payload ?? null);
    if (!payload?.selector) return;
    previewRef.current?.markElement(payload.selector, true);
    const component = primaryComponent(payload.component);
    const componentRef = component ? { name: component.name, file: component.file, line: component.line } : undefined;
    if (info.op === "set-classes") {
      const before = (previousClassesRef.current ?? selectedRef.current?.classes ?? []).join(" ");
      const after = (info.value ?? "").split(/\s+/).filter(Boolean).join(" ");
      recordEdit({ kind: "classes", selector: payload.selector, before, after, component: componentRef });
      previousClassesRef.current = undefined;
      notify(translate(language, "status.classesApplied"));
      return;
    }
    if (info.op === "set-text") {
      recordEdit({ kind: "text", selector: payload.selector, before: selectedRef.current?.text ?? "", after: info.value ?? payload.text ?? "", component: componentRef });
      notify(translate(language, "status.textApplied"));
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
      notify(translate(language, "status.attributeApplied"));
      return;
    }
    recordEdit({ kind: "structure", selector: payload.selector, operation: info.op, component: componentRef, requestId: info.requestId });
    notify(translate(language, "status.operationApplied"));
  };

  const handleRuntimeReady = useCallback(() => {
    // Marks live in the iframe and are wiped by ds:reload/HMR — replay them
    // whenever the runtime handshake resolves again.
    const selectors = new Set(editsRef.current.map((edit) => edit.selector));
    for (const selector of selectors) previewRef.current?.markElement(selector, true);
    // IMP-A: DOM edits are wiped by page reload/HMR too — re-apply the journal.
    const replay = toReplayEdits(editsRef.current);
    if (replay.length > 0) previewRef.current?.replayEdits(replay);
  }, []);

  const handleReplayed = useCallback((info: { applied: number; skipped: number }) => {
    if (info.applied > 0) {
      notify(translate(languageRef.current, "status.editsRestored", { count: String(info.applied) }));
    }
  }, [notify]);

  const handleUndone = (info: { requestId: string; success: boolean; payload?: ElementPayload | null }) => {
    if (!info.success) {
      notify(translate(languageRef.current, "status.undoFailed"));
      return;
    }
    const edit = editsRef.current.find((candidate) => candidate.requestId === info.requestId);
    if (!edit) return;
    const remaining = editsRef.current.filter((candidate) => candidate.requestId !== info.requestId);
    setEdits(remaining);
    if (!remaining.some((candidate) => candidate.selector === edit.selector)) {
      previewRef.current?.markElement(edit.selector, false);
    }
    notify(translate(languageRef.current, "status.undone"));
  };

  // IMP-A: undo any journal entry. Structure ops restore the runtime snapshot;
  // replayable kinds apply the before-value with forget:true (apply-then-drop
  // from the runtime reapply registry); comments only live in the journal.
  const handleUndoEdit = (edit: DesignEdit) => {
    if (edit.kind === "structure") {
      if (!edit.requestId) {
        notify(translate(languageRef.current, "status.undoFailed"));
        return;
      }
      previewRef.current?.undo(edit.requestId);
      return;
    }
    const removeEntry = () => {
      const remaining = editsRef.current.filter((candidate) => candidate !== edit);
      setEdits(remaining);
      if (!remaining.some((candidate) => candidate.selector === edit.selector)) {
        previewRef.current?.markElement(edit.selector, false);
      }
      notify(translate(languageRef.current, "status.editUndone"));
    };
    if (edit.kind === "comment") {
      removeEntry();
      return;
    }
    const sent = previewRef.current?.replayEdits([{
      kind: edit.kind,
      selector: edit.selector,
      ...(edit.kind === "style" || edit.kind === "attribute" ? { property: edit.property } : {}),
      value: edit.before ?? "",
      forget: true,
    }]) ?? false;
    if (!sent) {
      notify(translate(languageRef.current, "status.undoFailed"));
      return;
    }
    if (edit.kind === "style") {
      setPendingStyles((previous) => previous.filter((item) => !(item.selector === edit.selector && item.property === edit.property)));
    }
    removeEntry();
  };

  const handleSave = () => {
    if (pendingStyles.length === 0) {
      notify(translate(language, "status.noEdits"));
      return;
    }
    for (const edit of pendingStyles) postToExtension(buildStylePersistMessage(edit));
    notify(translate(language, "status.saving"));  };

  const handleCopyInstruction = (instruction: string) => {
    if (!selected && !instruction.trim() && edits.length === 0) {
      notify(translate(language, "status.noSelection"));
      return;
    }
    postToExtension({ type: "ai:copyInstruction", ...(selected ? { payload: selected } : {}), instruction, edits });
  };

  const handlePopupDraftChange = (selector: string, value: string) => {
    setPopupDrafts((previous) => ({ ...previous, [selector]: value }));
  };

  const handleAddComment = (text: string) => {
    const current = selectedRef.current;
    const trimmed = text.trim();
    if (!current?.selector || !trimmed) return;
    const selector = current.selector;
    setPopupDrafts((previous) => {
      const next = { ...previous };
      delete next[selector];
      return next;
    });
    const duplicate = editsRef.current.some((edit) => edit.kind === "comment" && edit.selector === selector && edit.after === trimmed);
    if (duplicate) return;
    const component = primaryComponent(current.component);
    recordEdit({
      kind: "comment",
      selector,
      after: trimmed,
      component: component ? { name: component.name, file: component.file, line: component.line } : undefined,
    });
    previewRef.current?.markElement(selector, true);
    notify(translate(language, "status.commentAdded"));
  };

  const hasSessionWork =
    edits.length > 0 || instruction.trim() !== "" || Object.values(popupDrafts).some((value) => value.trim() !== "");

  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const refreshOpenerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (refreshConfirmOpen) confirmCancelRef.current?.focus();
  }, [refreshConfirmOpen]);

  const closeRefreshConfirm = () => {
    setRefreshConfirmOpen(false);
    refreshOpenerRef.current?.focus();
  };

  const handleConfirmKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeRefreshConfirm();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  // window.confirm is unavailable inside VS Code webviews — the App renders
  // its own confirmation dialog and reloads via the container handle.
  const handleBeforeRefresh = (): boolean => {
    if (hasSessionWork) {
      refreshOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setRefreshConfirmOpen(true);
      return false;
    }
    clearPending();
    return true;
  };

  const handleConfirmRefresh = () => {
    closeRefreshConfirm();
    clearPending();
    resetSessionEdits();
    previewRef.current?.reload();
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
    postToExtension({ type: "journal:request", path });
  };

  const handleNavigateBlocked = (url: string) => {
    notify(translate(language, "status.externalLinkBlocked", { url }));
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
        onSetMode={setEditMode}
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
          onBeforeRefresh={handleBeforeRefresh}
          popupDrafts={popupDrafts}
          onPopupDraftChange={handlePopupDraftChange}
          onAddComment={handleAddComment}
          onSelect={setSelected}
          onStyleApplied={handleStyleApplied}
          onOpApplied={handleOpApplied}
          onRuntimeReady={handleRuntimeReady}
          onUndone={handleUndone}
          onReplayed={handleReplayed}
        />
        <Inspector
          selected={selected}
          language={language}
          onApplyStyle={handleChange}
          onApplyOp={applyOp}
          onEditText={(text) => applyOp("set-text", text)}
          onCopyComponent={handleCopyComponent}
          instruction={instruction}
          onInstructionChange={setInstruction}
          edits={edits}
          onCopyInstruction={handleCopyInstruction}
          onUndoEdit={handleUndoEdit}
          error={styleError}
        />
      </div>
      <FloatingPanel status={operationStatus} seq={toastSeq} language={language} onDismiss={() => setOperationStatus("")} />
      {refreshConfirmOpen && (
        <div
          className={styles.confirmOverlay}
          role="alertdialog"
          aria-modal="true"
          aria-label={translate(language, "preview.refreshConfirm")}
          onKeyDown={handleConfirmKeyDown}
        >
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>{translate(language, "preview.refreshConfirm")}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.confirmDanger} onClick={handleConfirmRefresh}>
                {translate(language, "preview.refreshContinue")}
              </button>
              <button type="button" ref={confirmCancelRef} onClick={closeRefreshConfirm}>
                {translate(language, "preview.refreshCancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
