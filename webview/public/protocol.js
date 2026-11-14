export const PROTOCOL_VERSION = "1";
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
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
export function isRuntimeMessage(value) {
    if (!value || typeof value !== "object")
        return false;
    const v = value;
    if (typeof v.type !== "string" || !RUNTIME_TYPES.has(v.type))
        return false;
    if (typeof v.version !== "string" || v.version !== PROTOCOL_VERSION)
        return false;
    switch (v.type) {
        case "ds:runtime-ready":
            if (v.nonce !== undefined && typeof v.nonce !== "string")
                return false;
            if (v.sessionId !== undefined && typeof v.sessionId !== "string")
                return false;
            return true;
        case "ds:ping":
            if (typeof v.nonce !== "string" || v.nonce.length === 0 || v.nonce.length > 128)
                return false;
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return true;
        case "ds:pong":
            if (typeof v.nonce !== "string" || v.nonce.length === 0 || v.nonce.length > 128)
                return false;
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return true;
        case "ds:set-mode":
            return typeof v.enabled === "boolean";
        case "ds:mode-changed":
            return typeof v.enabled === "boolean";
        case "ds:hover":
        case "ds:select":
            return isElementPayload(v.payload);
        case "ds:apply-style":
            if (typeof v.property !== "string" || !STYLE_PROPERTY_PATTERN.test(v.property))
                return false;
            if (typeof v.value !== "string" || v.value.length === 0 || v.value.length > 500)
                return false;
            if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128))
                return false;
            return true;
        case "ds:style-applied":
            if (typeof v.property !== "string")
                return false;
            if (typeof v.value !== "string")
                return false;
            if (typeof v.success !== "boolean")
                return false;
            if (v.reason !== undefined && (typeof v.reason !== "string" || v.reason.length > 500))
                return false;
            if (v.payload !== undefined && !isElementPayload(v.payload))
                return false;
            if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128))
                return false;
            return true;
        case "ds:runtime-error":
            return typeof v.message === "string" && v.message.length <= 500;
        default:
            return false;
    }
}
export function isElementPayload(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const v = value;
    if (typeof v.selector !== "string" || v.selector.length === 0 || v.selector.length > 500)
        return false;
    if (v.selectors !== undefined) {
        if (!Array.isArray(v.selectors) || v.selectors.length > 20)
            return false;
        if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500))
            return false;
    }
    if (typeof v.tag !== "string" || v.tag.length === 0 || v.tag.length > 64)
        return false;
    if (!v.rect || typeof v.rect !== "object" || Array.isArray(v.rect))
        return false;
    const r = v.rect;
    if (!isFiniteNumber(r.top) || !isFiniteNumber(r.left) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height))
        return false;
    if (r.width < 0 || r.height < 0)
        return false;
    if (!v.styles || typeof v.styles !== "object" || Array.isArray(v.styles))
        return false;
    const styles = v.styles;
    const keys = Object.keys(styles);
    if (keys.length > 64)
        return false;
    return keys.every((k) => typeof k === "string" && k.length <= 64 && typeof styles[k] === "string" && styles[k].length <= 500);
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
