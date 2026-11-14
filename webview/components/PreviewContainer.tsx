import React, { useEffect, useRef, useState } from "react";
import styles from "./PreviewContainer.module.css";
import type { ElementPayload } from "../types";

export function PreviewContainer({
  url,
  status,
  onRefresh,
  onSelect,
}: {
  url: string;
  status: string;
  onRefresh: () => void;
  onSelect: (payload: ElementPayload | null) => void;
}): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [hoverRect, setHoverRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "ds:set-mode", enabled: editMode }, "*");
  }, [editMode, url]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.type !== "string") return;
      if (data.type !== "ds:hover" && data.type !== "ds:select") return;
      const p = data.payload as ElementPayload;
      const rect = {
        top: p.rect.top,
        left: p.rect.left,
        width: p.rect.width,
        height: p.rect.height,
      };
      if (data.type === "ds:hover") {
        setHoverRect(rect);
      } else {
        setHoverRect(null);
        onSelect(p);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSelect]);

  return (
    <section className={styles.preview}>
      <div className={styles.bar}>
        <span className={styles.status}>Status: {status}</span>
        <span className={styles.url}>{url}</span>
        <label className={styles.toggle}>
          <input type="checkbox" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} /> Edit mode
        </label>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </div>
      <div className={styles.frame}>
        {url ? (
          <>
            <iframe ref={iframeRef} title="preview" src={url} className={styles.iframe} onLoad={() => console.log("iframe loaded", url)} onError={(e) => console.error("iframe error", e)} />
            {hoverRect && (
              <div
                className={styles.highlight}
                style={{ top: hoverRect.top, left: hoverRect.left, width: hoverRect.width, height: hoverRect.height }}
              />
            )}
          </>
        ) : (
          <span>Enter a preview URL above</span>
        )}
      </div>
    </section>
  );
}