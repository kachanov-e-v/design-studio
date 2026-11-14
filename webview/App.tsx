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

  useEffect(() => {
    postToExtension({ type: "preview:ready" });
    return onExtensionMessage((raw) => {
      const msg = raw as { type?: string; url?: string; status?: string; message?: string };
      if (msg?.type === "preview:state") {
        setPreviewUrl(msg.url ?? "");
        setStatus(msg.status ?? "idle");
      } else if (msg?.type === "preview:error") {
        setStatus("error");
      } else if (msg?.type === "persist:result") {
        const m = msg as { success?: boolean; message?: string };
        setStatus(m.success ? "ready" : "error");
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
    iframe?.contentWindow?.postMessage(
      { type: "ds:apply-style", version: PROTOCOL_VERSION, property, value },
      targetOrigin
    );
    if (selected) setLastChange({ selector: selected.selector, property, value });
  };

  const handleStyleApplied = (info: { property: string; value: string; payload?: ElementPayload }) => {
    setSelected((prev) => {
      if (!prev) return prev;
      if (info.payload) return info.payload;
      return { ...prev, styles: { ...prev.styles, [info.property]: info.value } };
    });
  };

  const handleSave = () => {
    if (!lastChange) {
      return;
    }
    postToExtension({ type: "style:persist", selector: lastChange.selector, property: lastChange.property, value: lastChange.value });
  };

  return (
    <div className={styles.root}>
      <Toolbar
        onSetUrl={handleSetUrl}
        currentUrl={previewUrl}
        editMode={editMode}
        onInspect={() => setEditMode((v) => !v)}
        onSave={handleSave}
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
        <Inspector selected={selected} onApplyStyle={applyStyle} />
      </div>
      <FloatingPanel selected={selected} lastChange={lastChange} />
    </div>
  );
}

function getTargetOrigin(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
  } catch {
    // ignore
  }
  return "*";
}
