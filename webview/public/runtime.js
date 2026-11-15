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
    collectReactComponents: () => collectReactComponents,
    findFiber: () => findFiber,
    getSelector: () => getSelector,
    getSelectorCandidates: () => getSelectorCandidates,
    initDesignStudioRuntime: () => initDesignStudioRuntime,
    parseOwnerStack: () => parseOwnerStack
  });

  // src/protocol.ts
  var PROTOCOL_VERSION = "1";
  var ELEMENT_OPS = ["set-text", "delete", "duplicate", "move-up", "move-down", "set-classes"];
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
    "ds:apply-op",
    "ds:op-applied",
    "ds:text-changed",
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
      case "ds:apply-op":
        if (!v.op || typeof v.op !== "string" || !ELEMENT_OPS.includes(v.op)) return false;
        if (v.value !== void 0 && (typeof v.value !== "string" || v.value.length > 5e3)) return false;
        if (v.requestId !== void 0 && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        if (v.selectors !== void 0) {
          if (!Array.isArray(v.selectors) || v.selectors.length > 20) return false;
          if (!v.selectors.every((s) => typeof s === "string" && s.length > 0 && s.length <= 500)) return false;
        }
        return true;
      case "ds:op-applied":
        if (typeof v.op !== "string" || !ELEMENT_OPS.includes(v.op)) return false;
        if (v.value !== void 0 && (typeof v.value !== "string" || v.value.length > 5e3)) return false;
        if (typeof v.success !== "boolean") return false;
        if (v.reason !== void 0 && (typeof v.reason !== "string" || v.reason.length > 500)) return false;
        if (v.payload !== void 0 && v.payload !== null && !isElementPayload(v.payload)) return false;
        if (v.requestId !== void 0 && (typeof v.requestId !== "string" || v.requestId.length === 0 || v.requestId.length > 128)) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return true;
      case "ds:text-changed":
        if (typeof v.text !== "string" || v.text.length > 5e3) return false;
        if (v.payload !== void 0 && !isElementPayload(v.payload)) return false;
        if (v.sessionId !== void 0 && (typeof v.sessionId !== "string" || v.sessionId.length > 128)) return false;
        return true;
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
    if (!keys.every((k) => typeof k === "string" && k.length <= 64 && typeof styles[k] === "string" && styles[k].length <= 500)) return false;
    if (v.text !== void 0 && (typeof v.text !== "string" || v.text.length > 2e3)) return false;
    if (v.classes !== void 0) {
      if (!Array.isArray(v.classes) || v.classes.length > 30) return false;
      if (!v.classes.every((c) => typeof c === "string" && c.length > 0 && c.length <= 100 && /[\s"<>\\]/.test(c) === false)) return false;
    }
    if (v.tailwind !== void 0 && typeof v.tailwind !== "boolean") return false;
    if (v.component !== void 0) {
      if (!Array.isArray(v.component) || v.component.length > 6) return false;
      for (const comp of v.component) {
        if (!comp || typeof comp !== "object" || Array.isArray(comp)) return false;
        const c = comp;
        if (c.name !== void 0 && (typeof c.name !== "string" || c.name.length === 0 || c.name.length > 100)) return false;
        if (c.file !== void 0 && (typeof c.file !== "string" || c.file.length === 0 || c.file.length > 500)) return false;
        if (c.line !== void 0 && (!isFiniteNumber(c.line) || c.line < 0 || c.line > 1e6)) return false;
        if (c.name === void 0 && c.file === void 0) return false;
      }
    }
    if (v.rules !== void 0) {
      if (!Array.isArray(v.rules) || v.rules.length > 8) return false;
      for (const rule of v.rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
        const r2 = rule;
        if (typeof r2.href !== "string" || r2.href.length === 0 || r2.href.length > 2e3) return false;
        if (typeof r2.selectorText !== "string" || r2.selectorText.length === 0 || r2.selectorText.length > 2e3) return false;
        if (r2.cssText !== void 0 && (typeof r2.cssText !== "string" || r2.cssText.length > 3e3)) return false;
      }
    }
    return true;
  }
  var STYLE_PROPERTY_PATTERN = /^[a-zA-Z-]+$/;
  function isValidClassListValue(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 1e3) return false;
    const tokens = value.split(" ");
    if (tokens.length > 30) return false;
    return tokens.every((t) => t.length > 0 && t.length <= 100 && !/["<>\\]/.test(t));
  }
  var STYLE_PROPS = [
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
    "cursor"
  ];

  // src/fiber.ts
  var SOURCE_FILE = /\.(tsx|jsx|ts|js|mjs|cjs)$/i;
  var NON_SOURCE_FRAME = /node_modules|chunks\/|\.next\/static|webpack\/bootstrap|polyfills|framework|main-app|_app-|internals/i;
  function asString(value, max) {
    if (typeof value !== "string") return void 0;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > max) return void 0;
    return trimmed;
  }
  function componentDisplayName(type) {
    if (typeof type === "function") {
      const fn = type;
      return asString(fn.displayName, 100) ?? asString(fn.name, 100);
    }
    if (type && typeof type === "object") {
      const wrapper = type;
      const inner = typeof wrapper.render === "function" || wrapper.render && typeof wrapper.render === "object" ? wrapper.render : typeof wrapper.type === "function" || wrapper.type && typeof wrapper.type === "object" ? wrapper.type : void 0;
      return asString(wrapper.displayName, 100) ?? asString(inner?.displayName, 100) ?? asString(inner?.name, 100);
    }
    return void 0;
  }
  function parseOwnerStack(stack, limit = 3) {
    const text = typeof stack === "string" ? stack : stack && typeof stack.stack === "string" ? stack.stack : void 0;
    if (!text) return [];
    const out = [];
    const re = /([^\s()"']+?\.(?:tsx|jsx|ts|js|mjs|cjs)):(\d+):(\d+)/g;
    let match;
    while ((match = re.exec(text)) !== null && out.length < limit) {
      let file = match[1];
      file = file.replace(/^(?:webpack-internal:\/\/\/?)/, "");
      const group = file.match(/^\([^)]*\)\/(.+)$/);
      if (group) file = group[1] ?? file;
      file = file.replace(/^\/(?:\.\/)?/, "./");
      if (!SOURCE_FILE.test(file) || NON_SOURCE_FRAME.test(file)) continue;
      const line = Number.parseInt(match[2], 10);
      out.push({ file, line: Number.isFinite(line) && line > 0 ? line : void 0 });
    }
    return out;
  }
  function sourceFromFiber(fiber) {
    const src = fiber._debugSource;
    if (src && typeof src === "object") {
      const file = asString(src.fileName, 500);
      const line = typeof src.lineNumber === "number" && Number.isFinite(src.lineNumber) && src.lineNumber > 0 ? src.lineNumber : void 0;
      if (file) return { file: file.replace(/^(?:webpack-internal:\/\/\/?)/, ""), line };
    }
    const stack = parseOwnerStack(fiber._debugStack, 1)[0];
    if (stack) return { file: stack.file, line: stack.line };
    return {};
  }
  function pushOwner(out, seen, owner, sourceOverride) {
    const name = componentDisplayName(owner.type);
    const { file, line } = sourceOverride ?? sourceFromFiber(owner);
    if (!name && !file) return;
    if (name && seen.has(name)) return;
    if (name) seen.add(name);
    out.push({ ...name !== void 0 ? { name } : {}, ...file !== void 0 ? { file, line } : {} });
  }
  function findFiber(el) {
    try {
      const holder = el;
      const fiberKey = Object.keys(holder).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternal$"));
      if (!fiberKey) return void 0;
      const fiber = holder[fiberKey];
      return fiber && typeof fiber === "object" ? fiber : void 0;
    } catch {
      return void 0;
    }
  }
  function collectReactComponents(el) {
    try {
      const fiber = findFiber(el);
      if (!fiber) return [];
      const seen = /* @__PURE__ */ new Set();
      const ownSource = sourceFromFiber(fiber);
      const out = [];
      let cur = fiber._debugOwner;
      let guard = 0;
      while (cur && typeof cur === "object" && guard++ < 32) {
        pushOwner(out, seen, cur, out.length === 0 && (ownSource.file || ownSource.line) ? ownSource : void 0);
        cur = cur._debugOwner;
      }
      if (out.length === 0) {
        cur = fiber.return;
        guard = 0;
        while (cur && typeof cur === "object" && guard++ < 48) {
          if (cur.type === void 0 || cur.type === null) break;
          if (typeof cur.type !== "string") {
            pushOwner(out, seen, cur, out.length === 0 && (ownSource.file || ownSource.line) ? ownSource : void 0);
          }
          cur = cur.return;
        }
      }
      return out.slice(0, 6);
    } catch {
      return [];
    }
  }

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
    let editingElement = null;
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
    function collectSourceRules(el) {
      const result = [];
      const seen = /* @__PURE__ */ new Set();
      for (const sheet of document.styleSheets) {
        if (!sheet.href) continue;
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (!(rule instanceof CSSStyleRule)) continue;
          const selectorText = rule.selectorText;
          if (!selectorText) continue;
          let matches = false;
          try {
            matches = el.matches(selectorText);
          } catch {
            continue;
          }
          if (!matches) continue;
          const key = `${sheet.href}\0${selectorText}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ href: sheet.href, selectorText, cssText: rule.cssText.slice(0, 2e3) });
          if (result.length >= 8) return result;
        }
      }
      return result.length > 0 ? result : void 0;
    }
    let tailwindDetected = null;
    function detectTailwindPage() {
      if (tailwindDetected === null) tailwindDetected = scanForTailwind();
      return tailwindDetected;
    }
    function scanForTailwind() {
      try {
        if (typeof window.tailwind === "object") return true;
        if (document.querySelector('script[src*="tailwind"]')) return true;
        let checked = 0;
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (checked >= 600) return false;
            checked++;
            const text = rule.cssText;
            if (typeof text !== "string") continue;
            if (text.includes("--tw-")) return true;
          }
        }
      } catch {
      }
      return false;
    }
    function collect(el) {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const styles = {};
      for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p).trim();
      const payload = {
        selector: getSelector(el),
        selectors: getSelectorCandidates(el),
        tag: el.tagName.toLowerCase(),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        styles
      };
      const classes = Array.from(el.classList).slice(0, 30).map((c) => c.slice(0, 100));
      if (classes.length > 0) payload.classes = classes;
      if (detectTailwindPage()) payload.tailwind = true;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length > 0) payload.text = text.slice(0, 2e3);
      const rules = collectSourceRules(el);
      if (rules) payload.rules = rules;
      const components = collectReactComponents(el);
      if (components.length > 0) payload.component = components;
      return payload;
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
    function postOpApplied(op, value, success, reason, payload, requestId) {
      postToParent({
        type: "ds:op-applied",
        version: PROTOCOL_VERSION,
        op,
        value,
        success,
        reason,
        payload,
        requestId,
        sessionId: activeSessionId || void 0
      });
    }
    function applyElementOp(op, value, requestId) {
      if (!selectedElement) {
        postOpApplied(op, value, false, "No selected element", null, requestId);
        return;
      }
      let payload = null;
      try {
        switch (op) {
          case "set-text": {
            const text = typeof value === "string" ? value.slice(0, 5e3) : "";
            selectedElement.textContent = text;
            payload = collect(selectedElement);
            postOpApplied(op, text, true, void 0, payload, requestId);
            return;
          }
          case "delete": {
            const parent = selectedElement.parentElement;
            selectedElement.remove();
            selectedElement = parent && parent !== document.body ? parent : null;
            payload = selectedElement ? collect(selectedElement) : null;
            postOpApplied(op, void 0, true, void 0, payload, requestId);
            return;
          }
          case "duplicate": {
            const clone = selectedElement.cloneNode(true);
            if (clone.id) clone.removeAttribute("id");
            clone.setAttribute("data-ds-clone", Date.now().toString(36));
            selectedElement.after(clone);
            selectedElement = clone;
            payload = collect(clone);
            postOpApplied(op, void 0, true, void 0, payload, requestId);
            return;
          }
          case "move-up": {
            const prev = selectedElement.previousElementSibling;
            if (!prev) {
              postOpApplied(op, void 0, false, "No previous sibling", payload, requestId);
              return;
            }
            selectedElement.parentElement?.insertBefore(selectedElement, prev);
            payload = collect(selectedElement);
            postOpApplied(op, void 0, true, void 0, payload, requestId);
            return;
          }
          case "move-down": {
            const next = selectedElement.nextElementSibling;
            if (!next) {
              postOpApplied(op, void 0, false, "No next sibling", payload, requestId);
              return;
            }
            next.after(selectedElement);
            payload = collect(selectedElement);
            postOpApplied(op, void 0, true, void 0, payload, requestId);
            return;
          }
          case "set-classes": {
            if (!isValidClassListValue(value)) {
              postOpApplied(op, value, false, "Invalid class list", null, requestId);
              return;
            }
            selectedElement.className = value;
            payload = collect(selectedElement);
            postOpApplied(op, value, true, void 0, payload, requestId);
            return;
          }
          default:
            postOpApplied(op, value, false, "Unknown op", null, requestId);
        }
      } catch {
        postOpApplied(op, value, false, "Failed to apply op", null, requestId);
      }
    }
    function postTextChanged(el) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 5e3);
      postToParent({
        type: "ds:text-changed",
        version: PROTOCOL_VERSION,
        text,
        payload: collect(el),
        sessionId: activeSessionId || void 0
      });
    }
    function startInlineEdit(el) {
      if (!(el instanceof HTMLElement)) return;
      if (el.isContentEditable) return;
      editingElement = el;
      el.contentEditable = "true";
      el.setAttribute("data-ds-editing", "");
      el.focus({ preventScroll: true });
    }
    function endInlineEdit(cancel) {
      const el = editingElement;
      if (!el) return;
      el.contentEditable = "false";
      el.removeAttribute("data-ds-editing");
      editingElement = null;
      if (cancel) return;
      postTextChanged(el);
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
      if (msg.type === "ds:apply-op") {
        if (activeSessionId && msg.sessionId !== activeSessionId) return;
        applyElementOp(msg.op, msg.value, msg.requestId);
        return;
      }
    });
    document.addEventListener(
      "dblclick",
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
        startInlineEdit(target);
      },
      true
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (!editingElement) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          endInlineEdit(true);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          endInlineEdit(false);
        }
      },
      true
    );
    document.addEventListener(
      "focusout",
      (e) => {
        if (!editingElement) return;
        if (e.target !== editingElement) return;
        endInlineEdit(false);
      },
      true
    );
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
        if (editingElement) return;
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
