import React, { useEffect, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { PreviewContainer } from "./components/PreviewContainer";
import { Inspector } from "./components/Inspector";
import { FloatingPanel } from "./components/FloatingPanel";
import { onExtensionMessage, postToExtension } from "./bridge";
import type { ElementPayload } from "./types";
import styles from "./App.module.css";

export function App(): React.ReactElement {
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [selected, setSelected] = useState<ElementPayload | null>(null);
  const [lastChange, setLastChange] = useState<{ selector: string; property: string; value: string } | null>(null);

  useEffect(() => {
    postToExtension({ type: "preview:ready" });
    return onExtensionMessage((raw) => {
      const msg = raw as { type?: string; url?: string; status?: string };
      if (msg?.type === "preview:state") {
        setPreviewUrl(msg.url ?? "");
        setStatus(msg.status ?? "idle");
      } else if (msg?.type === "preview:error") {
        setStatus("error");
      }
    });
  }, []);

  const handleSetUrl = (url: string) => {
    setPreviewUrl(url);
    postToExtension({ type: "preview:setUrl", url });
  };

  const applyStyle = (property: string, value: string) => {
    const iframe = document.querySelector('iframe[title="preview"]') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ type: "ds:apply-style", property, value }, "*");
    setSelected((prev) => (prev ? { ...prev, styles: { ...prev.styles, [property]: value } } : prev));
    if (selected) setLastChange({ selector: selected.selector, property, value });
  };

  return (
    <div className={styles.root}>
      <Toolbar onSetUrl={handleSetUrl} currentUrl={previewUrl} />
      <div className={styles.content}>
        <PreviewContainer url={previewUrl} status={status} onRefresh={() => postToExtension({ type: "preview:refresh" })} onSelect={setSelected} />
        <Inspector selected={selected} onApplyStyle={applyStyle} />
      </div>
      <FloatingPanel selected={selected} lastChange={lastChange} />
    </div>
  );
}