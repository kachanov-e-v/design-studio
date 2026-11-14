"use strict";
var DesignStudioRuntime = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    PROTOCOL_VERSION: () => PROTOCOL_VERSION,
    getSelector: () => getSelector,
    getSelectorCandidates: () => getSelectorCandidates,
    initDesignStudioRuntime: () => initDesignStudioRuntime
  });

  // src/protocol.ts
  var PROTOCOL_VERSION = "1";
  var RUNTIME_TYPES = /* @__PURE__ */ new Set([
    "ds:runtime-ready",
    "ds:ping",
    "ds:pong",
    "ds:set-mode",
    "ds:mode-changed",
    "ds:hover",
    "ds:select",
    "ds:apply-style",
    "ds:style-applied",
    "ds:runtime-error"
  ]);
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function isRuntimeMessage(value) {
    if (!value || typeof value !== "object") return false;
    const v = value;
    if (typeof v.type !== "string" || !RUNTIME_TYPES.has(v.type)) return false;
    if (typeof v.version !== "string" || v.version !== PROTOCOL_VERSION) return false;
    switch (v.type) {
      case "ds:runtime-ready":
        if (v.nonce !== void 0 && typeof v.nonce !== "string") return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return true;
      case "ds:ping":
        if (typeof v.nonce !== "string" || v.nonce.length === 0 || v.nonce.length > 128) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return true;
      case "ds:pong":
        if (typeof v.nonce !== "string" || v.nonce.length === 0 || v.nonce.length > 128) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return true;
      case "ds:set-mode":
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return typeof v.enabled === "boolean";
      case "ds:mode-changed":
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return typeof v.enabled === "boolean";
      case "ds:hover":
      case "ds:select":
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return isElementPayload(v.payload);
      case "ds:apply-style":
        if (typeof v.property !== "string" || !STYLE_PROPERTY_PATTERN.test(v.property)) return false;
        if (typeof v.value !== "string" || v.value.length === 0 || v.value.length > 500) return false;
        if (v.requestId !== void 0 && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        if (v.selectors !== void 0) {
          if (!Array.isArray(v.selectors) || v.selectors.length > 20) return false;
          if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500)) return false;
        }
        return true;
      case "ds:style-applied":
        if (typeof v.property !== "string") return false;
        if (typeof v.value !== "string") return false;
        if (typeof v.success !== "boolean") return false;
        if (v.reason !== void 0 && (typeof v.reason !== "string" || v.reason.length > 500)) return false;
        if (v.payload !== void 0 && !isElementPayload(v.payload)) return false;
        if (v.requestId !== void 0 && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return true;
      case "ds:runtime-error":
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return typeof v.message === "string" && v.message.length <= 500;
      default:
        return false;
    }
  }
  function isElementPayload(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const v = value;
    if (typeof v.selector !== "string" || v.selector.length === 0 || v.selector.length > 500) return false;
    if (v.selectors !== void 0) {
      if (!Array.isArray(v.selectors) || v.selectors.length > 20) return false;
      if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500)) return false;
    }
    if (typeof v.tag !== "string" || v.tag.length === 0 || v.tag.length > 64) return false;
    if (!v.rect || typeof v.rect !== "object" || Array.isArray(v.rect)) return false;
    const r = v.rect;
    if (!isFiniteNumber(r.top) || !isFiniteNumber(r.left) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return false;
    if (r.width < 0 || r.height < 0) return false;
    if (!v.styles || typeof v.styles !== "object" || Array.isArray(v.styles)) return false;
    const styles = v.styles;
    const keys = Object.keys(styles);
    if (keys.length > 64) return false;
    return keys.every((k) => typeof k === "string" && k.length <= 64 && typeof styles[k] === "string" && styles[k].length <= 500);
  }
  var STYLE_PROPERTY_PATTERN = /^[a-zA-Z-]+$/;
  var STYLE_PROPS = [
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
    "opacity"
  ];

  // src/index.ts
  function getSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
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
      if (current === document.body || current === null) break;
    }
    return parts.join(" > ");
  }
  function getSelectorCandidates(el) {
    const candidates = [];
    const tag = el.tagName.toLowerCase();
    if (el.id) candidates.push(`#${CSS.escape(el.id)}`);
    const classes = Array.from(el.classList).map((c) => CSS.escape(c));
    if (classes.length > 0) {
      const subsets = [];
      for (let size = 1; size <= classes.length; size++) {
        const combine = (start, current) => {
          if (current.length === size) {
            subsets.push([...current]);
            return;
          }
          for (let i = start; i < classes.length; i++) {
            current.push(classes[i]);
            combine(i + 1, current);
            current.pop();
          }
        };
        combine(0, []);
      }
      for (const subset of subsets) {
        candidates.push(`.${subset.join(".")}`);
        candidates.push(`${tag}.${subset.join(".")}`);
      }
    } else {
      candidates.push(tag);
    }
    const path = getSelector(el);
    if (!candidates.includes(path)) candidates.push(path);
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const candidate of candidates) {
      const normalized = candidate.trim();
      if (!normalized || normalized.length > 500 || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
      if (result.length >= 60) break;
    }
    return result;
  }
  function initDesignStudioRuntime() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let editMode = false;
    let selectedElement = null;
    let parentOrigin = "*";
    let activeSessionId = "";
    const isDesignStudioElement = (el) => {
      if (!el) return false;
      try {
        return Boolean(el.closest("[data-design-studio]"));
      } catch {
        return false;
      }
    };
    const toElement = (target) => {
      if (!target) return null;
      if (target instanceof Element) return target;
      const node = target;
      return node.parentElement ?? null;
    };
    function collect(el) {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const styles = {};
      for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p).trim();
      return {
        selector: getSelector(el),
        selectors: getSelectorCandidates(el),
        tag: el.tagName.toLowerCase(),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        styles
      };
    }
    function postToParent(msg) {
      try {
        const out = activeSessionId && !msg.sessionId ? { ...msg, sessionId: activeSessionId } : msg;
        window.parent.postMessage(out, parentOrigin || "*");
      } catch {
      }
    }
    function sendHoverOrSelect(type, el) {
      if (!editMode) return;
      if (isDesignStudioElement(el)) return;
      if (el === document.body || el === document.documentElement) return;
      const payload = collect(el);
      postToParent({ type, version: PROTOCOL_VERSION, payload, sessionId: activeSessionId || void 0 });
    }
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      if (parentOrigin !== "*" && event.origin && event.origin !== "null" && event.origin !== parentOrigin && !parentOrigin.includes("vscode-webview")) return;
      const data = event.data;
      if (data && typeof data === "object" && data.type === "ds:ping") {
        const ping = data;
        if (typeof ping.nonce !== "string" || ping.nonce.length === 0 || ping.nonce.length > 128) return;
        if (event.origin && event.origin !== "null") parentOrigin = event.origin;
        activeSessionId = typeof ping.sessionId === "string" && ping.sessionId.length > 0 ? ping.sessionId : ping.nonce;
        postToParent({
          type: "ds:pong",
          version: PROTOCOL_VERSION,
          nonce: ping.nonce,
          sessionId: activeSessionId
        });
        return;
      }
      if (!isRuntimeMessage(data)) return;
      const msg = data;
      const messageSessionId = msg.sessionId;
      if (activeSessionId && messageSessionId !== activeSessionId) return;
      if (msg.version !== PROTOCOL_VERSION) return;
      if (msg.type === "ds:set-mode") {
        if (activeSessionId && msg.sessionId !== activeSessionId) return;
        editMode = Boolean(msg.enabled);
        postToParent({ type: "ds:mode-changed", version: PROTOCOL_VERSION, enabled: editMode, sessionId: activeSessionId || msg.sessionId });
        return;
      }
      if (msg.type === "ds:apply-style") {
        if (activeSessionId && msg.sessionId !== activeSessionId) return;
        const { property, value, requestId } = msg;
        if (!STYLE_PROPERTY_PATTERN.test(property)) {
          postToParent({
            type: "ds:style-applied",
            version: PROTOCOL_VERSION,
            property,
            value,
            success: false,
            reason: "Invalid property",
            requestId,
            sessionId: activeSessionId || msg.sessionId
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
            requestId,
            sessionId: activeSessionId || msg.sessionId
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
            requestId,
            sessionId: activeSessionId || msg.sessionId
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
            requestId,
            sessionId: activeSessionId || msg.sessionId
          });
        } catch {
          postToParent({
            type: "ds:style-applied",
            version: PROTOCOL_VERSION,
            property,
            value,
            success: false,
            reason: "Failed to apply style",
            requestId,
            sessionId: activeSessionId || msg.sessionId
          });
        }
        return;
      }
    });
    let lastHover = 0;
    document.addEventListener(
      "mouseover",
      (e) => {
        if (!editMode) return;
        const now = Date.now();
        if (now - lastHover < 100) return;
        lastHover = now;
        const target = toElement(e.target);
        if (!target) return;
        sendHoverOrSelect("ds:hover", target);
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        if (!editMode) return;
        const target = toElement(e.target);
        if (!target) return;
        if (isDesignStudioElement(target)) return;
        if (target === document.body || target === document.documentElement) return;
        e.preventDefault();
        e.stopPropagation();
        selectedElement = target;
        sendHoverOrSelect("ds:select", target);
      },
      true
    );
  }
  if (typeof window !== "undefined") {
    console.log("Design Studio runtime loaded");
    initDesignStudioRuntime();
  }
  return __toCommonJS(src_exports);
})();
