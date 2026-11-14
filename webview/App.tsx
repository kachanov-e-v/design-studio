import React, { useEffect, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PreviewContainer } from "./components/PreviewContainer";
import { Inspector } from "./components/Inspector";
import { FloatingPanel } from "./components/FloatingPanel";
import { onExtensionMessage, postToExtension } from "./bridge";
import type { ElementPayload } from "./types";
import { PROTOCOL_VERSION } from "../packages/preview-runtime/src/protocol";
import styles from "./App.module.css";

export function App(): React.ReactElement {
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [selected, setSelected] = useState<ElementPayload | null>(null);
  const [lastChange, setLastChange] = useState<{ selector: string; property: string; value: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [operationStatus, setOperationStatus] = useState("");

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

  const handleSetUrl = (url: string) => {
    setPreviewUrl(url);
    postToExtension({ type: "preview:setUrl", url });
  };

  const applyStyle = (property: string, value: string) => {
    const iframe = document.querySelector('iframe[title="preview"]') as HTMLIFrameElement | null;
    const targetOrigin = getTargetOrigin(previewUrl);
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
    iframe?.contentWindow?.postMessage(
      { type: "ds:apply-style", version: PROTOCOL_VERSION, property, value, requestId, selectors: selected?.selectors },
      targetOrigin
    );
  };

  const handleStyleApplied = (info: { success: boolean; reason?: string; requestId?: string; property: string; value: string; payload?: ElementPayload }) => {
    if (!info.success) {
      setStyleError(info.reason ?? "Failed to apply style");
      return;
    }
    setStyleError("");
    setSelected((prev) => {
      if (info.payload) return info.payload;
      if (!prev) return prev;
      return { ...prev, styles: { ...prev.styles, [info.property]: info.value } };
    });
    const selector = info.payload?.selector ?? selected?.selector;
    if (selector) {
      setLastChange({ selector, property: info.property, value: info.value });
    }
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
          url={previewUrl}
          status={status}
          editMode={editMode}
          onEditModeChange={setEditMode}
          onRefresh={() => postToExtension({ type: "preview:refresh" })}
          onSelect={setSelected}
          onStyleApplied={handleStyleApplied}
        />
        <Inspector selected={selected} onApplyStyle={applyStyle} error={styleError} />
      </div>
      <FloatingPanel selected={selected} lastChange={lastChange} status={operationStatus} onSave={handleSave} onSendContext={handleSendContext} />
    </div>
  );
}

function getTargetOrigin(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
    if (u.origin && u.origin !== "null") return u.origin;
  } catch {
    // ignore
  }
  return "*";
}