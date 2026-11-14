import React, { useEffect, useRef, useState } from "react";
import styles from "./PreviewContainer.module.css";
import type { ElementPayload } from "../types";
import { PROTOCOL_VERSION, isRuntimeMessage } from "../../packages/preview-runtime/src/protocol";

export function PreviewContainer({
  url,
  status,
  editMode,
  onEditModeChange,
  onRefresh,
  onSelect,
  onStyleApplied,
}: {
  url: string;
  status: string;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  onRefresh: () => void;
  onSelect: (payload: ElementPayload | null) => void;
  onStyleApplied?: (info: { property: string; value: string; payload?: ElementPayload }) => void;
}): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onSelectRef = useRef(onSelect);
  const onStyleAppliedRef = useRef(onStyleApplied);
  const [runtimeStatus, setRuntimeStatus] = useState<"idle" | "connecting" | "ready" | "missing" | "error">("idle");
  const [hoverRect, setHoverRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onStyleAppliedRef.current = onStyleApplied;
  });

  useEffect(() => {
    setRuntimeStatus(url ? "connecting" : "idle");
    setHoverRect(null);
    onSelectRef.current(null);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (!url) return;
    timeoutRef.current = window.setTimeout(() => {
      setRuntimeStatus((prev) => (prev === "connecting" ? "missing" : prev));
    }, 2000);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [url, refreshKey]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!isRuntimeMessage(data)) return;

      if (data.type === "ds:runtime-ready") {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        setRuntimeStatus("ready");
        iframe.contentWindow?.postMessage(
          { type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: editMode },
          "*"
        );
        return;
      }
      if (data.type === "ds:mode-changed") {
        if (data.enabled !== editMode) {
          onEditModeChange(data.enabled);
        }
        return;
      }
      if (data.type === "ds:hover") {
        const p = data.payload;
        setHoverRect({ top: p.rect.top, left: p.rect.left, width: p.rect.width, height: p.rect.height });
        return;
      }
      if (data.type === "ds:select") {
        setHoverRect(null);
        onSelectRef.current(data.payload);
        return;
      }
      if (data.type === "ds:style-applied") {
        onStyleAppliedRef.current?.({ property: data.property, value: data.value, payload: data.payload });
        return;
      }
      if (data.type === "ds:runtime-error") {
        setRuntimeStatus("error");
        return;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [editMode, onEditModeChange]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    if (runtimeStatus !== "ready") return;
    iframe.contentWindow.postMessage(
      { type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: editMode },
      "*"
    );
  }, [editMode, runtimeStatus]);

  const runtimeLabel =
    runtimeStatus === "idle"
      ? "Preview not loaded"
      : runtimeStatus === "connecting"
      ? "Connecting Design Studio Runtime…"
      : runtimeStatus === "ready"
      ? "Runtime connected"
      : runtimeStatus === "missing"
      ? "Runtime not detected"
      : "Unable to connect to preview";

  const statusText =
    runtimeStatus === "ready"
      ? editMode
        ? "Edit mode enabled"
        : "Edit mode disabled"
      : runtimeLabel;

  return (
    <section className={styles.preview}>
      <div className={styles.bar}>
        <span className={styles.status}>Status: {status}</span>
        <span className={styles.url}>{url}</span>
        <span className={styles.status}>{statusText}</span>
        <label className={styles.toggle}>
          <input type="checkbox" checked={editMode} onChange={(e) => onEditModeChange(e.target.checked)} /> Edit mode
        </label>
        <button
          type="button"
          onClick={() => {
            setRefreshKey((k) => k + 1);
            onRefresh();
          }}
        >
          Refresh
        </button>
      </div>
      <div className={styles.frame}>
        {url ? (
          <>
            <iframe
              ref={iframeRef}
              key={`${url}::${refreshKey}`}
              title="preview"
              src={url}
              className={styles.iframe}
              onLoad={() => {}}
              onError={() => setRuntimeStatus("error")}
            />
            {hoverRect && (
              <div
                className={styles.highlight}
                style={{ top: hoverRect.top, left: hoverRect.left, width: hoverRect.width, height: hoverRect.height }}
              />
            )}
            {runtimeStatus === "missing" && (
              <div className={styles.overlay} role="status">
                Runtime not detected. Import @design-studio/preview-runtime in your app.
              </div>
            )}
            {runtimeStatus === "error" && (
              <div className={styles.overlay} role="status">
                Unable to connect to preview
              </div>
            )}
          </>
        ) : (
          <span>Loading preview…</span>
        )}
      </div>
    </section>
  );
}
