export const PROTOCOL_VERSION = "1";

/** A CSS rule from a real stylesheet the element matches. */
export interface SourceRule {
  href: string;
  selectorText: string;
  cssText?: string;
}

/** A React component that owns (rendered) the element, nearest first. */
export interface ComponentInfo {
  name?: string;
  /** Source file of the component, e.g. a webpack-internal or bundler-native path. */
  file?: string;
  line?: number;
}

export interface ElementPayload {
  selector: string;
  selectors?: string[];
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
  classes?: string[];
  /** true when the page was detected to use Tailwind CSS. */
  tailwind?: boolean;
  text?: string;
  rules?: SourceRule[];
  /** React owner component chain (dev mode only), nearest owner first. */
  component?: ComponentInfo[];
}

export type ElementOp = "set-text" | "delete" | "duplicate" | "move-up" | "move-down" | "set-classes";

export const ELEMENT_OPS: readonly ElementOp[] = ["set-text", "delete", "duplicate", "move-up", "move-down", "set-classes"];

export interface ApplyOpMessage {
  type: "ds:apply-op";
  version: string;
  op: ElementOp;
  value?: string;
  requestId?: string;
  sessionId?: string;
  selectors?: string[];
}

export interface OpAppliedMessage {
  type: "ds:op-applied";
  version: string;
  op: ElementOp;
  value?: string;
  success: boolean;
  reason?: string;
  payload?: ElementPayload | null;
  requestId?: string;
  sessionId?: string;
}

export interface TextChangedMessage {
  type: "ds:text-changed";
  version: string;
  text: string;
  payload?: ElementPayload;
  sessionId?: string;
}

export interface NavigateMessage {
  type: "ds:navigate";
  version: string;
  path: string;
  sessionId?: string;
}

export interface NavigateHistoryMessage {
  type: "ds:navigate-history";
  version: string;
  direction: "back" | "forward";
  sessionId?: string;
}

export interface ReloadMessage {
  type: "ds:reload";
  version: string;
  sessionId?: string;
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
  | ApplyOpMessage
  | OpAppliedMessage
  | TextChangedMessage
  | NavigateMessage
  | NavigateHistoryMessage
  | ReloadMessage
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
  "ds:apply-op",
  "ds:op-applied",
  "ds:text-changed",
  "ds:navigate",
  "ds:navigate-history",
  "ds:reload",
  "ds:runtime-error",
]);;

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
      if (typeof v.value !== "string" || v.value.length > 500) return false;
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
    case "ds:apply-op":
      if (!v.op || typeof v.op !== "string" || !ELEMENT_OPS.includes(v.op as ElementOp)) return false;
      if (v.value !== undefined && (typeof v.value !== "string" || v.value.length > 5000)) return false;
      if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      if (v.selectors !== undefined) {
        if (!Array.isArray(v.selectors) || v.selectors.length > 20) return false;
        if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500)) return false;
      }
      return true;
    case "ds:op-applied":
      if (typeof v.op !== "string" || !ELEMENT_OPS.includes(v.op as ElementOp)) return false;
      if (v.value !== undefined && (typeof v.value !== "string" || v.value.length > 5000)) return false;
      if (typeof v.success !== "boolean") return false;
      if (v.reason !== undefined && (typeof v.reason !== "string" || v.reason.length > 500)) return false;
      if (v.payload !== undefined && v.payload !== null && !isElementPayload(v.payload)) return false;
      if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:text-changed":
      if (typeof v.text !== "string" || v.text.length > 5000) return false;
      if (v.payload !== undefined && !isElementPayload(v.payload)) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:navigate":
      if (typeof v.path !== "string" || v.path.length > 4000 || !v.path.startsWith("/")) return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:navigate-history":
      if (v.direction !== "back" && v.direction !== "forward") return false;
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
    case "ds:reload":
      if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
      return true;
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
  if (keys.length > STYLE_PROPS.length) return false;
  if (!keys.every((k) => typeof k === "string" && k.length <= 64 && typeof styles[k] === "string" && (styles[k] as string).length <= 500)) return false;
  if (v.text !== undefined && (typeof v.text !== "string" || v.text.length > 2000)) return false;
  if (v.classes !== undefined) {
    if (!Array.isArray(v.classes) || v.classes.length > 30) return false;
    if (!v.classes.every((c) => typeof c === "string" && c.length > 0 && c.length <= 100 && /[\s"<>\\]/.test(c) === false)) return false;
  }
  if (v.tailwind !== undefined && typeof v.tailwind !== "boolean") return false;
  if (v.component !== undefined) {
    if (!Array.isArray(v.component) || v.component.length > 6) return false;
    for (const comp of v.component) {
      if (!comp || typeof comp !== "object" || Array.isArray(comp)) return false;
      const c = comp as Record<string, unknown>;
      if (c.name !== undefined && (typeof c.name !== "string" || c.name.length === 0 || c.name.length > 100)) return false;
      if (c.file !== undefined && (typeof c.file !== "string" || c.file.length === 0 || c.file.length > 500)) return false;
      if (c.line !== undefined && (!isFiniteNumber(c.line) || c.line < 0 || c.line > 1000000)) return false;
      if (c.name === undefined && c.file === undefined) return false;
    }
  }
  if (v.rules !== undefined) {
    if (!Array.isArray(v.rules) || v.rules.length > 8) return false;
    for (const rule of v.rules) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
      const r = rule as Record<string, unknown>;
      if (typeof r.href !== "string" || r.href.length === 0 || r.href.length > 2000) return false;
      if (typeof r.selectorText !== "string" || r.selectorText.length === 0 || r.selectorText.length > 2000) return false;
      if (r.cssText !== undefined && (typeof r.cssText !== "string" || r.cssText.length > 3000)) return false;
    }
  }
  return true;
}

export const STYLE_PROPERTY_PATTERN = /^(?:--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/;

/** Validate the `value` of a `set-classes` op: a space-separated class list. */
export function isValidClassListValue(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  if (value.trim() === "") return true;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length > 30) return false;
  return tokens.every((t) => t.length > 0 && t.length <= 100 && !/["<>\\]/.test(t));
}

export const STYLE_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "margin",
  "padding",
  "color",
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "box-sizing",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "white-space",
  "word-break",
  "vertical-align",
  "flex-direction",
  "justify-content",
  "align-items",
  "align-self",
  "flex-wrap",
  "flex",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "order",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "box-shadow",
  "outline",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "object-fit",
  "aspect-ratio",
  "transform",
  "transition",
  "z-index",
  "cursor",
];
