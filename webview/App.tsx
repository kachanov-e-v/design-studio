import React, { useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PreviewContainer, type PreviewContainerHandle } from "./components/PreviewContainer";
import { Inspector } from "./components/Inspector";
import { FloatingPanel } from "./components/FloatingPanel";
import { onExtensionMessage, postToExtension } from "./bridge";
import type { ElementPayload } from "./types";
import styles from "./App.module.css";

interface PendingRequest {
  requestId: string;
  sessionId: string;
  selector: string | undefined;
  property: string;
  value: string;
  timeoutId: number;
}

export function App(): React.ReactElement {
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [selected, setSelected] = useState<ElementPayload | null>(null);
  const [lastChange, setLastChange] = useState<{ selector: string; property: string; value: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [operationStatus, setOperationStatus] = useState("");

  const previewRef = useRef<PreviewContainerHandle | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());

  const clearPending = () => {
    for (const pending of pendingRequestsRef.current.values()) {
      window.clearTimeout(pending.timeoutId);
    }
    pendingRequestsRef.current.clear();
  };

  useEffect(() => {
    postToExtension({ type: "preview:ready" });
    return onExtensionMessage((raw) => {
      const msg = raw as { type?: string; url?: string; status?: string; message?: string; success?: boolean };
      if (msg?.type === "preview:state") {
        setPreviewUrl(msg.url ?? "");
        setStatus(msg.status ?? "idle");
      } else if (msg?.type === "preview:error") {
        setStatus("error");
        setOperationStatus(msg.message ?? "Preview error");
      } else if (msg?.type === "persist:result") {
        if (msg.success) {
          setOperationStatus(msg.message ?? "Saved");
        } else {
          setOperationStatus(msg.message ?? "Save failed");
          setStatus("error");
        }
      } else if (msg?.type === "kilo:result") {
        setOperationStatus(msg.message ?? (msg.success ? "Done" : "Failed"));
      }
    });
  }, []);

  useEffect(() => {
    clearPending();
    setSelected(null);
    setLastChange(null);
    setStyleError("");
  }, [previewUrl]);

  const handleSetUrl = (url: string) => {
    setPreviewUrl(url);
    postToExtension({ type: "preview:setUrl", url });
  };

  const handleApplyStyle = (property: string, value: string) => {
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
      selector: selected?.selector,
      property,
      value,
      timeoutId,
    });
    setOperationStatus("Applying...");
  };

  const handleStyleApplied = (info: { success: boolean; reason?: string; requestId?: string; sessionId?: string; property: string; value: string; payload?: ElementPayload }) => {
    const requestId = info.requestId;
    if (!requestId) return;
    const pending = pendingRequestsRef.current.get(requestId);
    if (!pending) return;
    if (info.sessionId && info.sessionId !== pending.sessionId) return;
    if (info.property !== pending.property) return;

    window.clearTimeout(pending.timeoutId);
    pendingRequestsRef.current.delete(requestId);

    if (!info.success) {
      setStyleError(info.reason ?? "Failed to apply style");
      setOperationStatus(info.reason ?? "Failed to apply style");
      return;
    }

    if (pending.selector && info.payload?.selector && info.payload.selector !== pending.selector) {
      return;
    }

    setStyleError("");
    setSelected((prev) => {
      if (info.payload) return info.payload;
      if (!prev) return prev;
      return { ...prev, styles: { ...prev.styles, [info.property]: info.value } };
    });
    const selector = info.payload?.selector ?? pending.selector;
    if (selector) {
      setLastChange({ selector, property: info.property, value: info.value });
    }
    setOperationStatus("Applied");
  };

  const handleSave = () => {
    if (!lastChange) return;
    postToExtension({ type: "style:persist", selector: lastChange.selector, property: lastChange.property, value: lastChange.value, selectors: selected?.selectors });
  };

  const handleSendContext = (instruction: string) => {
    if (!selected) {
      setOperationStatus("Select an element first");
      return;
    }
    postToExtension({ type: "kilo:sendContext", payload: selected, instruction });
    setOperationStatus("Sending...");
  };

  return (
    <div className={styles.root}>
      <Toolbar
        onSetUrl={handleSetUrl}
        currentUrl={previewUrl}
        editMode={editMode}
        onInspect={() => setEditMode((v) => !v)}
        onSave={handleSave}
        canSave={Boolean(lastChange)}
      />
      <div className={styles.content}>
        <PreviewContainer
          ref={previewRef}
          url={previewUrl}
          status={status}
          editMode={editMode}
          onEditModeChange={setEditMode}
          onRefresh={() => {
            clearPending();
            postToExtension({ type: "preview:refresh" });
          }}
          onSelect={setSelected}
          onStyleApplied={handleStyleApplied}
        />
        <Inspector selected={selected} onApplyStyle={handleApplyStyle} error={styleError} />
      </div>
      <FloatingPanel selected={selected} lastChange={lastChange} status={operationStatus} onSave={handleSave} onSendContext={handleSendContext} />
    </div>
  );
}