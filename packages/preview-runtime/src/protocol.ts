export const PROTOCOL_VERSION = "1";

export interface ElementPayload {
  selector: string;
  selectors?: string[];
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
}

export interface RuntimeReadyMessage {
  type: "ds:runtime-ready";
  version: string;
  nonce?: string;
  sessionId?: string;
}

export interface PingMessage {
  type: "ds:ping";
  version: string;
  nonce: string;
  sessionId?: string;
}

export interface PongMessage {
  type: "ds:pong";
  version: string;
  nonce: string;
  sessionId?: string;
}

export interface SetModeMessage {
  type: "ds:set-mode";
  version: string;
  enabled: boolean;
  sessionId?: string;
}

export interface ModeChangedMessage {
  type: "ds:mode-changed";
  version: string;
  enabled: boolean;
  sessionId?: string;
}

export interface HoverMessage {
  type: "ds:hover";
  version: string;
  payload: ElementPayload;
  sessionId?: string;
}

export interface SelectMessage {
  type: "ds:select";
  version: string;
  payload: ElementPayload;
  sessionId?: string;
}

export interface ApplyStyleMessage {
  type: "ds:apply-style";
  version: string;
  property: string;
  value: string;
  requestId?: string;
  sessionId?: string;
  selectors?: string[];
}

export interface StyleAppliedMessage {
  type: "ds:style-applied";
  version: string;
  property: string;
  value: string;
  success: boolean;
  reason?: string;
  payload?: ElementPayload;
  requestId?: string;
  sessionId?: string;
}

export interface RuntimeErrorMessage {
  type: "ds:runtime-error";
  version: string;
  message: string;
  sessionId?: string;
}

export type RuntimeMessage =
  | RuntimeReadyMessage
  | PingMessage
  | PongMessage
  | SetModeMessage
  | ModeChangedMessage
  | HoverMessage
  | SelectMessage
  | ApplyStyleMessage
  | StyleAppliedMessage
  | RuntimeErrorMessage;

const RUNTIME_TYPES = new Set([
  "ds:runtime-ready",
  "ds:ping",
  "ds:pong",
  "ds:set-mode",
  "ds:mode-changed",
  "ds:hover",
  "ds:select",
  "ds:apply-style",
  "ds:style-applied",
  "ds:runtime-error",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string" || !RUNTIME_TYPES.has(v.type)) return false;
  if (typeof v.version !== "string" || v.version !== PROTOCOL_VERSION) return false;
  switch (v.type) {
    case "ds:runtime-ready":
      if (v.nonce !== undefined && typeof v.nonce !== "string") return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:ping":
      if (typeof v.nonce !== "string" || v.nonce.length === 0 || v.nonce.length > 128) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:pong":
      if (typeof v.nonce !== "string" || v.nonce.length === 0 || v.nonce.length > 128) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:set-mode":
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return typeof v.enabled === "boolean";
    case "ds:mode-changed":
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return typeof v.enabled === "boolean";
    case "ds:hover":
    case "ds:select":
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return isElementPayload(v.payload);
    case "ds:apply-style":
      if (typeof v.property !== "string" || !STYLE_PROPERTY_PATTERN.test(v.property)) return false;
      if (typeof v.value !== "string" || v.value.length === 0 || v.value.length > 500) return false;
      if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      if (v.selectors !== undefined) {
        if (!Array.isArray(v.selectors) || v.selectors.length > 20) return false;
        if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500)) return false;
      }
      return true;
    case "ds:style-applied":
      if (typeof v.property !== "string") return false;
      if (typeof v.value !== "string") return false;
      if (typeof v.success !== "boolean") return false;
      if (v.reason !== undefined && (typeof v.reason !== "string" || v.reason.length > 500)) return false;
      if (v.payload !== undefined && !isElementPayload(v.payload)) return false;
      if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:runtime-error":
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return typeof v.message === "string" && v.message.length <= 500;
    default:
      return false;
  }
}

export function isElementPayload(value: unknown): value is ElementPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.selector !== "string" || v.selector.length === 0 || v.selector.length > 500) return false;
  if (v.selectors !== undefined) {
    if (!Array.isArray(v.selectors) || v.selectors.length > 20) return false;
    if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500)) return false;
  }
  if (typeof v.tag !== "string" || v.tag.length === 0 || v.tag.length > 64) return false;
  if (!v.rect || typeof v.rect !== "object" || Array.isArray(v.rect)) return false;
  const r = v.rect as Record<string, unknown>;
  if (!isFiniteNumber(r.top) || !isFiniteNumber(r.left) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return false;
  if (r.width < 0 || r.height < 0) return false;
  if (!v.styles || typeof v.styles !== "object" || Array.isArray(v.styles)) return false;
  const styles = v.styles as Record<string, unknown>;
  const keys = Object.keys(styles);
  if (keys.length > 64) return false;
  return keys.every((k) => typeof k === "string" && k.length <= 64 && typeof styles[k] === "string" && (styles[k] as string).length <= 500);
}

export const STYLE_PROPERTY_PATTERN = /^[a-zA-Z-]+$/;
export const STYLE_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "border",
  "border-radius",
  "opacity",
];
