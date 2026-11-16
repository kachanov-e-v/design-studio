import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import styles from "./PreviewContainer.module.css";
import type { EditableAttribute, ElementOp, ElementPayload } from "../types";
import { PROTOCOL_VERSION, isRuntimeMessage } from "@design-studio/preview-runtime/protocol";
import { translate, type Language } from "@design-studio/shared/i18n";
import { SelectionPopup, type SelectionPopupTarget } from "./SelectionPopup";

export interface RevealComponentInfo {
  name?: string;
  file?: string;
  line?: number;
}

export interface PreviewContainerHandle {
  applyStyle: (property: string, value: string) => { requestId: string; sessionId: string } | null;
  applyOp: (op: ElementOp, value?: string, attribute?: EditableAttribute) => { requestId: string; sessionId: string } | null;
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

export interface OpAppliedInfo {
  op: ElementOp;
  value?: string;
  attribute?: EditableAttribute;
  success: boolean;
  reason?: string;
  payload?: ElementPayload | null;
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

function makeRequestId(): string {
  return makeSessionId();
}

export const PreviewContainer = React.forwardRef<PreviewContainerHandle, {
  url: string;
  status: string;
  language: Language;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  onRefresh: () => void;
  devServer?: string;
  onNavigate: (url: string) => void;
  onLocationChange: (path: string) => void;
  onSelect: (payload: ElementPayload | null) => void;
  onNavigateBlocked?: (url: string) => void;
  onRevealSource?: (components: RevealComponentInfo[]) => void;
  onCopyInstruction?: (instruction: string) => void;
  onStyleApplied?: (info: { success: boolean; reason?: string; requestId?: string; sessionId?: string; property: string; value: string; payload?: ElementPayload }) => void;
  onOpApplied?: (info: OpAppliedInfo) => void;
}>(function PreviewContainer(
  {
    url,
    status,
    language,
    editMode,
    onEditModeChange,
    onRefresh,
    devServer,
    onNavigate,
    onLocationChange,
    onSelect,
    onNavigateBlocked,
    onRevealSource,
    onCopyInstruction,
    onStyleApplied,
    onOpApplied,
  },
  ref
): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onSelectRef = useRef(onSelect);
  const onNavigateBlockedRef = useRef(onNavigateBlocked);
  const onStyleAppliedRef = useRef(onStyleApplied);
  const onOpAppliedRef = useRef(onOpApplied);
  const onEditModeChangeRef = useRef(onEditModeChange);
  const onLocationChangeRef = useRef(onLocationChange);
  const editModeRef = useRef(editMode);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("idle");
  const [refreshKey, setRefreshKey] = useState(0);
  const [diagnostic, setDiagnostic] = useState("");
  const [address, setAddress] = useState(devServer ?? "");
  const [popupTarget, setPopupTarget] = useState<SelectionPopupTarget | null>(null);
  const languageRef = useRef(language);
  languageRef.current = language;

  const sessionIdRef = useRef("");
  const resolvedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const missingTimerRef = useRef<number | null>(null);
  const MAX_RETRIES = 5;

  useEffect(() => {
    onSelectRef.current = onSelect;
    onStyleAppliedRef.current = onStyleApplied;
    onOpAppliedRef.current = onOpApplied;
    onNavigateBlockedRef.current = onNavigateBlocked;
    onEditModeChangeRef.current = onEditModeChange;
    onLocationChangeRef.current = onLocationChange;
    editModeRef.current = editMode;
  });

  useEffect(() => {
    setAddress(devServer ?? "");
  }, [devServer, url]);

  useEffect(() => {
    setPopupTarget(null);
  }, [url, refreshKey]);

  useEffect(() => {
    if (!editMode) setPopupTarget(null);
  }, [editMode]);

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
            setDiagnostic(languageRef.current === "ru" ? "Время ожидания подключения истекло." : "Connection handshake timed out.");
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
      const requestId = makeRequestId();
      iframe.contentWindow.postMessage(
        { type: "ds:apply-style", version: PROTOCOL_VERSION, property, value, requestId, sessionId: sessionIdRef.current },
        "*"
      );
      return { requestId, sessionId: sessionIdRef.current };
    },
    applyOp: (op, value, attribute) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || !sessionIdRef.current || runtimeStatus !== "ready") return null;
      const requestId = makeRequestId();
      iframe.contentWindow.postMessage(
        { type: "ds:apply-op", version: PROTOCOL_VERSION, op, value, attribute, requestId, sessionId: sessionIdRef.current },
        "*"
      );
      return { requestId, sessionId: sessionIdRef.current };
    },
  }), [runtimeStatus, url]);

  useEffect(() => {
    clearTimers();
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
          setDiagnostic(languageRef.current === "ru"
            ? `Ожидалась версия ${PROTOCOL_VERSION}, получена ${raw.version}.`
            : `Expected ${PROTOCOL_VERSION}, received ${raw.version}.`);
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
          "*"
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
      if (data.type === "ds:select") {
        onSelectRef.current(data.payload);
        setPopupTarget(
          data.payload
            ? { rect: data.payload.rect, components: data.payload.component }
            : null
        );
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
      if (data.type === "ds:op-applied") {
        onOpAppliedRef.current?.({
          op: data.op as ElementOp,
          value: data.value,
          attribute: data.attribute as EditableAttribute | undefined,
          success: data.success,
          reason: data.reason,
          payload: data.payload ?? null,
        });
        return;
      }
      if (data.type === "ds:navigate") {
        try {
          if (devServer) setAddress(`${new URL(devServer).origin}${data.path}`);
        } catch {
          // Ignore navigation addresses when the project has no server URL.
        }
        onLocationChangeRef.current(data.path);
        return;
      }
      if (data.type === "ds:navigate-blocked") {
        onNavigateBlockedRef.current?.(data.url);
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
      "*"
    );
  }, [editMode, runtimeStatus, url]);

  const runtimeLabel =
    runtimeStatus === "idle"
      ? translate(language, "preview.idle")
      : runtimeStatus === "iframe-loading"
      ? translate(language, "preview.iframeLoading")
      : runtimeStatus === "connecting"
      ? translate(language, "preview.connecting")
      : runtimeStatus === "ready"
      ? translate(language, "preview.connected")
      : runtimeStatus === "missing"
      ? translate(language, "preview.missing")
      : runtimeStatus === "protocol-mismatch"
      ? translate(language, "preview.protocolMismatch")
      : runtimeStatus === "blocked-or-load-error"
      ? translate(language, "preview.blocked")
      : translate(language, "preview.error");

  const statusText =
    runtimeStatus === "ready"
      ? editMode
        ? translate(language, "preview.editEnabled")
        : translate(language, "preview.editDisabled")
      : runtimeLabel;
  const projectStatus = status === "project"
    ? (language === "ru" ? "проект" : "project")
    : status === "devserver"
      ? (language === "ru" ? "сервер" : "server")
      : status === "demo"
        ? translate(language, "toolbar.demo")
        : status;

  const submitAddress = () => {
    const value = address.trim();
    if (!value) return;
    try {
      const current = devServer ? new URL(devServer) : null;
      const base = current ? `${current.origin}/` : undefined;
      const next = new URL(value, base);
      if (next.protocol !== "http:" && next.protocol !== "https:") return;
      onNavigate(next.toString());
      setAddress(next.toString());
    } catch {
      // Keep the typed value available for correction.
    }
  };

  const moveHistory = (direction: "back" | "forward") => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || runtimeStatus !== "ready" || !sessionIdRef.current) return;
    iframe.contentWindow.postMessage({
      type: "ds:navigate-history",
      version: PROTOCOL_VERSION,
      direction,
      sessionId: sessionIdRef.current,
    }, "*");
  };

  const reloadPreview = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow && runtimeStatus === "ready" && sessionIdRef.current) {
      iframe.contentWindow.postMessage({
        type: "ds:reload",
        version: PROTOCOL_VERSION,
        sessionId: sessionIdRef.current,
      }, "*");
    } else {
      setRefreshKey((key) => key + 1);
    }
    onRefresh();
  };

  return (
    <section className={styles.preview}>
      <div className={styles.bar}>
        <span className={styles.status}>{translate(language, "preview.status")}: {projectStatus}</span>
        {status === "devserver" && (
          <>
            <button type="button" title={translate(language, "preview.back")} aria-label={translate(language, "preview.back")} disabled={runtimeStatus !== "ready"} onClick={() => moveHistory("back")}>←</button>
            <button type="button" title={translate(language, "preview.forward")} aria-label={translate(language, "preview.forward")} disabled={runtimeStatus !== "ready"} onClick={() => moveHistory("forward")}>→</button>
            <form className={styles.addressForm} onSubmit={(event) => { event.preventDefault(); submitAddress(); }}>
              <input
                className={styles.address}
                type="text"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={translate(language, "preview.addressPlaceholder")}
                aria-label={translate(language, "preview.addressPlaceholder")}
              />
            </form>
            <button type="button" title={translate(language, "preview.go")} aria-label={translate(language, "preview.go")} onClick={submitAddress}>↵</button>
          </>
        )}
        <span className={styles.status}>{statusText}</span>
        {editMode && runtimeStatus === "ready" && <span className={styles.hint}>{translate(language, "preview.selectHint")}</span>}
        <button
          type="button"
          onClick={reloadPreview}
        >
          {translate(language, "preview.refresh")}
        </button>
      </div>
      <div className={styles.frame}>
        {url ? (
          <>
            <iframe
              ref={iframeRef}
              key={`${url}::${refreshKey}`}
              title={translate(language, "toolbar.title")}
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
            {runtimeStatus === "missing" && (
              <div className={styles.overlay} role="status">
                {translate(language, "preview.runtimeMissing")}
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
                {translate(language, "preview.connecting")}
              </div>
            )}
            {popupTarget && editMode && runtimeStatus === "ready" && onRevealSource && onCopyInstruction && (
              <SelectionPopup
                target={popupTarget}
                language={language}
                onReveal={(components) => onRevealSource?.(components)}
                onCopyInstruction={(instruction) => onCopyInstruction?.(instruction)}
              />
            )}
          </>
        ) : (
          <span>{translate(language, "preview.iframeLoading")}</span>
        )}
      </div>
    </section>
  );
});

PreviewContainer.displayName = "PreviewContainer";
