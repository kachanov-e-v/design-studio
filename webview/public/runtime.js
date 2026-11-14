import { PROTOCOL_VERSION, isRuntimeMessage, STYLE_PROPS, STYLE_PROPERTY_PATTERN, } from "./protocol.js";
export { PROTOCOL_VERSION } from "./protocol.js";
export function initDesignStudioRuntime() {
    if (typeof window === "undefined" || typeof document === "undefined")
        return;
    let editMode = false;
    let selectedElement = null;
    let readySent = false;
    const isDesignStudioElement = (el) => {
        if (!el)
            return false;
        try {
            return Boolean(el.closest("[data-design-studio]"));
        }
        catch {
            return false;
        }
    };
    const toElement = (target) => {
        if (!target)
            return null;
        if (target instanceof Element)
            return target;
        const node = target;
        return node.parentElement ?? null;
    };
    function getSelector(el) {
        if (el.id)
            return `#${CSS.escape(el.id)}`;
        const parts = [];
        let current = el;
        let depth = 0;
        while (current && current.nodeType === 1 && depth < 6) {
            let part = current.tagName.toLowerCase();
            if (current.classList.length) {
                part += "." + Array.from(current.classList).slice(0, 2).map(CSS.escape).join(".");
            }
            const parentEl = current.parentElement;
            if (parentEl) {
                const siblings = Array.from(parentEl.children).filter((c) => c.tagName === current.tagName);
                if (siblings.length > 1) {
                    part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                }
            }
            parts.unshift(part);
            current = parentEl;
            depth++;
            if (current === document.body || current === null)
                break;
        }
        return parts.join(" > ");
    }
    function collect(el) {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const styles = {};
        for (const p of STYLE_PROPS)
            styles[p] = cs.getPropertyValue(p).trim();
        return {
            selector: getSelector(el),
            tag: el.tagName.toLowerCase(),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            styles,
        };
    }
    function postToParent(msg) {
        try {
            window.parent.postMessage(msg, "*");
        }
        catch {
            // ignore
        }
    }
    function sendHoverOrSelect(type, el) {
        if (!editMode)
            return;
        if (isDesignStudioElement(el))
            return;
        if (el === document.body || el === document.documentElement)
            return;
        const payload = collect(el);
        postToParent({ type, version: PROTOCOL_VERSION, payload });
    }
    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!isRuntimeMessage(data))
            return;
        const msg = data;
        if (msg.type === "ds:set-mode") {
            editMode = Boolean(msg.enabled);
            postToParent({ type: "ds:mode-changed", version: PROTOCOL_VERSION, enabled: editMode });
            return;
        }
        if (msg.type === "ds:apply-style") {
            const { property, value } = msg;
            if (!STYLE_PROPERTY_PATTERN.test(property)) {
                postToParent({
                    type: "ds:style-applied",
                    version: PROTOCOL_VERSION,
                    property,
                    value,
                    success: false,
                    reason: "Invalid property",
                });
                return;
            }
            if (typeof value !== "string" || value.length === 0 || value.length > 500) {
                postToParent({
                    type: "ds:style-applied",
                    version: PROTOCOL_VERSION,
                    property,
                    value: String(value ?? ""),
                    success: false,
                    reason: "Invalid value",
                });
                return;
            }
            if (!selectedElement) {
                postToParent({
                    type: "ds:style-applied",
                    version: PROTOCOL_VERSION,
                    property,
                    value,
                    success: false,
                    reason: "No selected element",
                });
                return;
            }
            try {
                selectedElement.style.setProperty(property, value);
                const actual = getComputedStyle(selectedElement).getPropertyValue(property).trim();
                const payload = collect(selectedElement);
                postToParent({
                    type: "ds:style-applied",
                    version: PROTOCOL_VERSION,
                    property,
                    value: actual || value,
                    success: true,
                    payload,
                });
            }
            catch {
                postToParent({
                    type: "ds:style-applied",
                    version: PROTOCOL_VERSION,
                    property,
                    value,
                    success: false,
                    reason: "Failed to apply style",
                });
            }
            return;
        }
    });
    let lastHover = 0;
    document.addEventListener("mouseover", (e) => {
        if (!editMode)
            return;
        const now = Date.now();
        if (now - lastHover < 100)
            return;
        lastHover = now;
        const target = toElement(e.target);
        if (!target)
            return;
        sendHoverOrSelect("ds:hover", target);
    }, true);
    document.addEventListener("click", (e) => {
        if (!editMode)
            return;
        const target = toElement(e.target);
        if (!target)
            return;
        if (isDesignStudioElement(target))
            return;
        if (target === document.body || target === document.documentElement)
            return;
        e.preventDefault();
        e.stopPropagation();
        selectedElement = target;
        sendHoverOrSelect("ds:select", target);
    }, true);
    if (!readySent) {
        readySent = true;
        postToParent({ type: "ds:runtime-ready", version: PROTOCOL_VERSION });
    }
}
if (typeof window !== "undefined") {
    console.log("Design Studio runtime loaded");
    initDesignStudioRuntime();
}
