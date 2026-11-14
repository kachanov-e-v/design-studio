export const PROTOCOL_VERSION = "1";

export interface ElementPayload {
  selector: string;
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
}

export interface RuntimeReadyMessage {
  type: "ds:runtime-ready";
  version: string;
}

export interface SetModeMessage {
  type: "ds:set-mode";
  version: string;
  enabled: boolean;
}

export interface ModeChangedMessage {
  type: "ds:mode-changed";
  version: string;
  enabled: boolean;
}

export interface HoverMessage {
  type: "ds:hover";
  version: string;
  payload: ElementPayload;
}

export interface SelectMessage {
  type: "ds:select";
  version: string;
  payload: ElementPayload;
}

export interface ApplyStyleMessage {
  type: "ds:apply-style";
  version: string;
  property: string;
  value: string;
}

export interface StyleAppliedMessage {
  type: "ds:style-applied";
  version: string;
  property: string;
  value: string;
  success: boolean;
  reason?: string;
  payload?: ElementPayload;
}

export interface RuntimeErrorMessage {
  type: "ds:runtime-error";
  version: string;
  message: string;
}

export type RuntimeMessage =
  | RuntimeReadyMessage
  | SetModeMessage
  | ModeChangedMessage
  | HoverMessage
  | SelectMessage
  | ApplyStyleMessage
  | StyleAppliedMessage
  | RuntimeErrorMessage;

const RUNTIME_TYPES = new Set([
  "ds:runtime-ready",
  "ds:set-mode",
  "ds:mode-changed",
  "ds:hover",
  "ds:select",
  "ds:apply-style",
  "ds:style-applied",
  "ds:runtime-error",
]);

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string" || !RUNTIME_TYPES.has(v.type)) return false;
  if (typeof v.version !== "string" || v.version !== PROTOCOL_VERSION) return false;
  switch (v.type) {
    case "ds:runtime-ready":
      return true;
    case "ds:set-mode":
      return typeof v.enabled === "boolean";
    case "ds:mode-changed":
      return typeof v.enabled === "boolean";
    case "ds:hover":
    case "ds:select":
      return isElementPayload(v.payload);
    case "ds:apply-style":
      return typeof v.property === "string" && typeof v.value === "string";
    case "ds:style-applied":
      return typeof v.property === "string" && typeof v.value === "string" && typeof v.success === "boolean";
    case "ds:runtime-error":
      return typeof v.message === "string";
    default:
      return false;
  }
}

export function isElementPayload(value: unknown): value is ElementPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.selector !== "string") return false;
  if (typeof v.tag !== "string") return false;
  if (!v.rect || typeof v.rect !== "object") return false;
  const r = v.rect as Record<string, unknown>;
  if (typeof r.top !== "number" || typeof r.left !== "number" || typeof r.width !== "number" || typeof r.height !== "number") return false;
  if (!v.styles || typeof v.styles !== "object") return false;
  return true;
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
