import React, { useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PreviewContainer, type PreviewContainerHandle, type OpAppliedInfo } from "./components/PreviewContainer";
import { Inspector } from "./components/Inspector";
import { FloatingPanel } from "./components/FloatingPanel";
import { onExtensionMessage, postToExtension } from "./bridge";
import type { ElementOp, ElementPayload, PreviewStateMessage } from "./types";
import styles from "./App.module.css";

interface PendingStyleRequest {
  requestId: string;
  sessionId: string;
  selector?: string;
  property: string;
  value: string;
  timeoutId: number;
}

interface PendingStyleEdit {
  selector: string;
  selectors?: string[];
  property: string;
  value: string;
}

export function App(): React.ReactElement {
  const [state, setState] = useState<Partial<PreviewStateMessage>>({ url: "", status: "idle" });
  const [selected, setSelected] = useState<ElementPayload | null>(null);
  const [pendingStyles, setPendingStyles] = useState<PendingStyleEdit[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [operationStatus, setOperationStatus] = useState("");

  const previewRef = useRef<PreviewContainerHandle | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingStyleRequest>>(new Map());
  const selectedRef = useRef<ElementPayload | null>(null);
  selectedRef.current = selected;

  const clearPending = () => {
    for (const pending of pendingRequestsRef.current.values()) {
      window.clearTimeout(pending.timeoutId);
    }
    pendingRequestsRef.current.clear();
  };

  useEffect(() => {
    postToExtension({ type: "preview:ready" });
    return onExtensionMessage((raw) => {
      const msg = raw as {
        type?: string;
        message?: string;
        success?: boolean;
        pendingChanges?: number;
        changeId?: string;
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
          pendingChanges: msg.pendingChanges,
        });
      } else if (msg.type === "preview:error") {
        setState((s) => ({ ...s, status: "error" }));
        setOperationStatus(msg.message ?? "Preview error");
      } else if (msg.type === "persist:result") {
        if (msg.success) {
          setPendingStyles([]);
          setOperationStatus(msg.message ?? "Saved");
        } else {
          setOperationStatus(msg.message ?? "Save failed");
        }
      } else if (msg.type === "journal:result") {
        if (msg.success) {
          setState((s) => ({ ...s, pendingChanges: msg.pendingChanges }));
        }
        setOperationStatus(msg.message ?? "");
      } else if (msg.type === "ai:result") {
        setOperationStatus(msg.message ?? (msg.success ? "Handoff done" : "Handoff failed"));
      } else if (msg.type === "mcp:result") {
        setOperationStatus(msg.message ?? "");
      }
    });
  }, []);

  useEffect(() => {
    clearPending();
    setSelected(null);
    setPendingStyles([]);
    setStyleError("");
  }, [state.url]);

  const handleChange = (property: string, value: string) => {
    const result = previewRef.current?.applyStyle(property, value) ?? null;
    if (!result) {
      setStyleError("Runtime not connected");
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const pending = pendingRequestsRef.current.get(result.requestId);
      if (!pending) return;
      pendingRequestsRef.current.delete(result.requestId);
      setStyleError("Style apply timed out");
      setOperationStatus("Style apply timed out");
    }, 5000);
    pendingRequestsRef.current.set(result.requestId, {
      requestId: result.requestId,
      sessionId: result.sessionId,
      selector: selectedRef.current?.selector,
      property,
      value,
      timeoutId,
    });
    setOperationStatus("Applying…");
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
    if (!pending) return;
    if (info.sessionId && info.sessionId !== pending.sessionId) return;

    window.clearTimeout(pending.timeoutId);
    pendingRequestsRef.current.delete(requestId);

    if (!info.success) {
      setStyleError(info.reason ?? "Failed to apply style");
      setOperationStatus(info.reason ?? "Failed to apply style");
      return;
    }

    setStyleError("");
    const payload = info.payload ?? undefined;
    setSelected((prev) => {
      const base = payload ?? prev;
      if (!base) return prev;
      return { ...base, styles: { ...base.styles, [info.property]: info.value } };
    });
    const selector = payload?.selector ?? pending.selector;
    if (selector) {
      setPendingStyles((prevStyles) => [
        ...prevStyles.filter((p) => !(p.selector === selector && p.property === info.property)),
        { selector, selectors: payload?.selectors, property: info.property, value: info.value },
      ]);
      setOperationStatus("Applied — press Save to commit");
    }
  };

  const applyOp = (op: ElementOp, value?: string) => {
    const result = previewRef.current?.applyOp(op, value) ?? null;
    if (!result) {
      setStyleError("Runtime not connected");
    }
  };

  const handleOpApplied = (info: OpAppliedInfo) => {
    if (!info.success) {
      setOperationStatus(info.reason ?? "Block operation failed");
      return;
    }
    setSelected(info.payload ?? null);
    const selector = info.payload?.selector ?? selectedRef.current?.selector;
    if (info.op === "set-text") {
      if (selector) {
        postToExtension({
          type: "journal:recordChange",
          kind: "text",
          selector,
          selectors: info.payload?.selectors,
          text: info.value,
        });
      }
      setOperationStatus("Text applied — press Save to commit");
      return;
    }
    if (!selector) return;
    postToExtension({
      type: "journal:recordChange",
      kind: "structure",
      selector,
      op: info.op,
      note: "structural edit, the AI agent must mirror it in source files",
    });
    setOperationStatus("Block operation recorded for the AI agent");
  };

  const handleTextChanged = (info: { text: string; payload?: ElementPayload }) => {
    const selector = info.payload?.selector;
    if (!selector) return;
    setSelected(info.payload ?? null);
    postToExtension({
      type: "journal:recordChange",
      kind: "text",
      selector,
      selectors: info.payload?.selectors,
      text: info.text,
    });
    setOperationStatus("Inline text change recorded for the AI agent");
  };

  const handleSave = () => {
    if (pendingStyles.length === 0) {
      setOperationStatus("No style edits to save. Block/text edits are already in the journal.");
      return;
    }
    for (const edit of pendingStyles) {
      postToExtension({ type: "style:persist", ...edit });
    }
    setOperationStatus("Saving…");
  };

  const handleSendToAgent = (instruction: string) => {
    if (!selected) {
      setOperationStatus("Select an element first");
      return;
    }
    postToExtension({ type: "ai:sendElement", payload: selected, instruction });
    setOperationStatus("Sending to AI agent…");
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
        onInspect={() => setEditMode((v) => !v)}
        onSave={handleSave}
        canSave={pendingStyles.length > 0}
      />
      <div className={styles.content}>
        <PreviewContainer
          ref={previewRef}
          url={state.url ?? ""}
          status={state.status ?? "idle"}
          editMode={editMode}
          onEditModeChange={setEditMode}
          onRefresh={() => {
            clearPending();
            postToExtension({ type: "preview:refresh" });
          }}
          onSelect={setSelected}
          onStyleApplied={handleStyleApplied}
          onOpApplied={handleOpApplied}
          onTextChanged={handleTextChanged}
        />
        <Inspector selected={selected} onApplyStyle={handleChange} onApplyOp={applyOp} onEditText={(text) => applyOp("set-text", text)} error={styleError} />
      </div>
      <FloatingPanel
        selected={selected}
        status={operationStatus}
        pendingChanges={state.pendingChanges ?? 0}
        onSendToAgent={handleSendToAgent}
        onCopyMcpConfig={() => postToExtension({ type: "mcp:copyConfig" })}
      />
    </div>
  );
}
