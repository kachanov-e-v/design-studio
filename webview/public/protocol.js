export const PROTOCOL_VERSION = "1";
export const ELEMENT_OPS = ["set-text", "delete", "duplicate", "move-up", "move-down", "set-classes"];
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
    "ds:runtime-error",
]);
;
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
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
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
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return typeof v.enabled === "boolean";
        case "ds:mode-changed":
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return typeof v.enabled === "boolean";
        case "ds:hover":
        case "ds:select":
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return isElementPayload(v.payload);
        case "ds:apply-style":
            if (typeof v.property !== "string" || !STYLE_PROPERTY_PATTERN.test(v.property))
                return false;
            if (typeof v.value !== "string" || v.value.length === 0 || v.value.length > 500)
                return false;
            if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128))
                return false;
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            if (v.selectors !== undefined) {
                if (!Array.isArray(v.selectors) || v.selectors.length > 20)
                    return false;
                if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500))
                    return false;
            }
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
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return true;
        case "ds:runtime-error":
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return typeof v.message === "string" && v.message.length <= 500;
        case "ds:apply-op":
            if (!v.op || typeof v.op !== "string" || !ELEMENT_OPS.includes(v.op))
                return false;
            if (v.value !== undefined && (typeof v.value !== "string" || v.value.length > 5000))
                return false;
            if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128))
                return false;
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            if (v.selectors !== undefined) {
                if (!Array.isArray(v.selectors) || v.selectors.length > 20)
                    return false;
                if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500))
                    return false;
            }
            return true;
        case "ds:op-applied":
            if (typeof v.op !== "string" || !ELEMENT_OPS.includes(v.op))
                return false;
            if (v.value !== undefined && (typeof v.value !== "string" || v.value.length > 5000))
                return false;
            if (typeof v.success !== "boolean")
                return false;
            if (v.reason !== undefined && (typeof v.reason !== "string" || v.reason.length > 500))
                return false;
            if (v.payload !== undefined && v.payload !== null && !isElementPayload(v.payload))
                return false;
            if (v.requestId !== undefined && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128))
                return false;
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return true;
        case "ds:text-changed":
            if (typeof v.text !== "string" || v.text.length > 5000)
                return false;
            if (v.payload !== undefined && !isElementPayload(v.payload))
                return false;
            if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || v.sessionId.length > 128))
                return false;
            return true;
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
    if (!keys.every((k) => typeof k === "string" && k.length <= 64 && typeof styles[k] === "string" && styles[k].length <= 500))
        return false;
    if (v.text !== undefined && (typeof v.text !== "string" || v.text.length > 2000))
        return false;
    if (v.classes !== undefined) {
        if (!Array.isArray(v.classes) || v.classes.length > 30)
            return false;
        if (!v.classes.every((c) => typeof c === "string" && c.length > 0 && c.length <= 100 && /[\s"<>\\]/.test(c) === false))
            return false;
    }
    if (v.tailwind !== undefined && typeof v.tailwind !== "boolean")
        return false;
    if (v.component !== undefined) {
        if (!Array.isArray(v.component) || v.component.length > 6)
            return false;
        for (const comp of v.component) {
            if (!comp || typeof comp !== "object" || Array.isArray(comp))
                return false;
            const c = comp;
            if (c.name !== undefined && (typeof c.name !== "string" || c.name.length === 0 || c.name.length > 100))
                return false;
            if (c.file !== undefined && (typeof c.file !== "string" || c.file.length === 0 || c.file.length > 500))
                return false;
            if (c.line !== undefined && (!isFiniteNumber(c.line) || c.line < 0 || c.line > 1000000))
                return false;
            if (c.name === undefined && c.file === undefined)
                return false;
        }
    }
    if (v.rules !== undefined) {
        if (!Array.isArray(v.rules) || v.rules.length > 8)
            return false;
        for (const rule of v.rules) {
            if (!rule || typeof rule !== "object" || Array.isArray(rule))
                return false;
            const r = rule;
            if (typeof r.href !== "string" || r.href.length === 0 || r.href.length > 2000)
                return false;
            if (typeof r.selectorText !== "string" || r.selectorText.length === 0 || r.selectorText.length > 2000)
                return false;
            if (r.cssText !== undefined && (typeof r.cssText !== "string" || r.cssText.length > 3000))
                return false;
        }
    }
    return true;
}
export const STYLE_PROPERTY_PATTERN = /^[a-zA-Z-]+$/;
/** Validate the `value` of a `set-classes` op: a space-separated class list. */
export function isValidClassListValue(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 1000)
        return false;
    const tokens = value.split(" ");
    if (tokens.length > 30)
        return false;
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
    "margin",
    "padding",
    "color",
    "background-color",
    "font-size",
    "font-family",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "flex-direction",
    "justify-content",
    "align-items",
    "flex-wrap",
    "gap",
    "border",
    "border-color",
    "border-width",
    "border-style",
    "border-radius",
    "box-shadow",
    "opacity",
    "overflow",
    "z-index",
    "cursor",
];
