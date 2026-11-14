import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import styles from "./PreviewContainer.module.css";
import type { ElementPayload } from "../types";
import { PROTOCOL_VERSION, isRuntimeMessage } from "@design-studio/preview-runtime/protocol";

export interface PreviewContainerHandle {
  applyStyle: (property: string, value: string) => { requestId: string; sessionId: string } | null;
}

type RuntimeStatus =
  | "idle"
  | "iframe-loading"
  | "connecting"
  | "ready"
  | "missing"
  | "protocol-mismatch"
  | "blocked-or-load-error"
  | "error";

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

function makeSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `ds-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const PreviewContainer = React.forwardRef<PreviewContainerHandle, {
  url: string;
  status: string;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  onRefresh: () => void;
  onSelect: (payload: ElementPayload | null) => void;
  onStyleApplied?: (info: { success: boolean; reason?: string; requestId?: string; sessionId?: string; property: string; value: string; payload?: ElementPayload }) => void;
}>(function PreviewContainer(
  {
    url,
    status,
    editMode,
    onEditModeChange,
    onRefresh,
    onSelect,
    onStyleApplied,
  },
  ref
): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onSelectRef = useRef(onSelect);
  const onStyleAppliedRef = useRef(onStyleApplied);
  const onEditModeChangeRef = useRef(onEditModeChange);
  const editModeRef = useRef(editMode);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("idle");
  const [hoverRect, setHoverRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [diagnostic, setDiagnostic] = useState("");

  const sessionIdRef = useRef("");
  const resolvedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const missingTimerRef = useRef<number | null>(null);
  const MAX_RETRIES = 5;

  useEffect(() => {
    onSelectRef.current = onSelect;
    onStyleAppliedRef.current = onStyleApplied;
    onEditModeChangeRef.current = onEditModeChange;
    editModeRef.current = editMode;
  });

  const clearTimers = () => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (missingTimerRef.current) {
      window.clearTimeout(missingTimerRef.current);
      missingTimerRef.current = null;
    }
  };

  const sendPing = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    const nonce = sessionIdRef.current;
    if (!nonce) return;
    iframe.contentWindow.postMessage(
      { type: "ds:ping", version: PROTOCOL_VERSION, nonce, sessionId: nonce },
      "*"
    );
  };

  const startHandshake = () => {
    clearTimers();
    resolvedRef.current = false;
    let attempts = 0;
    const currentSession = sessionIdRef.current;
    const tryPing = () => {
      if (resolvedRef.current || sessionIdRef.current !== currentSession) return;
      sendPing();
      attempts += 1;
      if (attempts <= MAX_RETRIES) {
        retryTimerRef.current = window.setTimeout(tryPing, 300);
      } else {
        missingTimerRef.current = window.setTimeout(() => {
          if (!resolvedRef.current && sessionIdRef.current === currentSession) {
            setRuntimeStatus("missing");
            setDiagnostic("Runtime did not respond to handshake before timeout.");
          }
        }, 700);
      }
    };
    tryPing();
  };

  useImperativeHandle(ref, () => ({
    applyStyle: (property, value) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || !sessionIdRef.current || runtimeStatus !== "ready") return null;
      const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      iframe.contentWindow.postMessage(
        { type: "ds:apply-style", version: PROTOCOL_VERSION, property, value, requestId, sessionId: sessionIdRef.current },
        getTargetOrigin(url)
      );
      return { requestId, sessionId: sessionIdRef.current };
    },
  }), [runtimeStatus, url]);

  useEffect(() => {
    clearTimers();
    setHoverRect(null);
    onSelectRef.current(null);
    setDiagnostic("");
    if (!url) {
      setRuntimeStatus("idle");
      sessionIdRef.current = "";
      return;
    }
    resolvedRef.current = false;
    sessionIdRef.current = makeSessionId();
    setRuntimeStatus("connecting");
    return () => {
      clearTimers();
    };
  }, [url, refreshKey]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      if (event.source !== iframe.contentWindow) return;
      const raw = event.data as { type?: unknown; version?: unknown; nonce?: unknown; sessionId?: unknown };

      if (raw?.type === "ds:pong" || raw?.type === "ds:runtime-ready") {
        if (typeof raw.version === "string" && raw.version !== PROTOCOL_VERSION) {
          clearTimers();
          setRuntimeStatus("protocol-mismatch");
          setDiagnostic(`Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${raw.version}.`);
          return;
        }
        const nonce = typeof raw.nonce === "string" ? raw.nonce : undefined;
        const sid = typeof raw.sessionId === "string" ? raw.sessionId : undefined;
        if (nonce && nonce !== sessionIdRef.current) return;
        if (!nonce) return;
        if (sid && sid !== sessionIdRef.current) return;
        clearTimers();
        resolvedRef.current = true;
        setRuntimeStatus("ready");
        setDiagnostic("");
        iframe.contentWindow?.postMessage(
          { type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: editModeRef.current, sessionId: sessionIdRef.current },
          getTargetOrigin(url)
        );
        return;
      }

      if (!isRuntimeMessage(raw)) return;
      const data = raw as unknown as import("../../packages/preview-runtime/src/protocol").RuntimeMessage;

      const messageSession = (data as { sessionId?: unknown }).sessionId;
      if (typeof messageSession !== "string" || messageSession !== sessionIdRef.current) return;

      if (data.type === "ds:mode-changed") {
        if (data.enabled !== editModeRef.current) {
          onEditModeChangeRef.current(data.enabled);
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
        onStyleAppliedRef.current?.({
          success: data.success,
          reason: data.reason,
          requestId: data.requestId,
          sessionId: data.sessionId,
          property: data.property,
          value: data.value,
          payload: data.payload,
        });
        return;
      }
      if (data.type === "ds:runtime-error") {
        setRuntimeStatus("error");
        setDiagnostic(data.message);
        return;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [url]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    if (runtimeStatus !== "ready") return;
    iframe.contentWindow.postMessage(
      { type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: editMode, sessionId: sessionIdRef.current },
      getTargetOrigin(url)
    );
  }, [editMode, runtimeStatus, url]);

  const runtimeLabel =
    runtimeStatus === "idle"
      ? "Preview not loaded"
      : runtimeStatus === "iframe-loading"
      ? "Loading preview iframe…"
      : runtimeStatus === "connecting"
      ? "Connecting Design Studio Runtime…"
      : runtimeStatus === "ready"
      ? "Runtime connected"
      : runtimeStatus === "missing"
      ? "Runtime not detected"
      : runtimeStatus === "protocol-mismatch"
      ? "Runtime protocol mismatch"
      : runtimeStatus === "blocked-or-load-error"
      ? "Preview blocked or failed to load"
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
              onLoad={() => {
                if (url) startHandshake();
              }}
              onError={() => {
                setRuntimeStatus("blocked-or-load-error");
                setDiagnostic("iframe failed to load.");
              }}
            />
            {hoverRect && (
              <div
                className={styles.highlight}
                style={{ top: hoverRect.top, left: hoverRect.left, width: hoverRect.width, height: hoverRect.height }}
              />
            )}
            {runtimeStatus === "missing" && (
              <div className={styles.overlay} role="status">
                Runtime not detected. Import @design-studio/preview-runtime in your app entry point, then restart the dev server.
                {diagnostic ? ` ${diagnostic}` : ""}
              </div>
            )}
            {runtimeStatus === "error" && (
              <div className={styles.overlay} role="status">
                Unable to connect to preview. {diagnostic}
              </div>
            )}
            {runtimeStatus === "protocol-mismatch" && (
              <div className={styles.overlay} role="status">
                Runtime protocol mismatch. {diagnostic}
              </div>
            )}
            {runtimeStatus === "blocked-or-load-error" && (
              <div className={styles.overlay} role="status">
                Unable to connect to preview. {diagnostic}
              </div>
            )}
            {runtimeStatus === "connecting" && (
              <div className={styles.overlay} role="status">
                Connecting Design Studio Runtime…
              </div>
            )}
          </>
        ) : (
          <span>Loading preview…</span>
        )}
      </div>
    </section>
  );
});

PreviewContainer.displayName = "PreviewContainer";