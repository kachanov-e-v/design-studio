import {
  PROTOCOL_VERSION,
  type ElementOp,
  type ElementPayload,
  type RuntimeMessage,
  type SourceRule,
  isRuntimeMessage,
  isValidClassListValue,
  STYLE_PROPS,
  STYLE_PROPERTY_PATTERN,
} from "./protocol.js";
import { collectReactComponents } from "./fiber.js";

export { PROTOCOL_VERSION } from "./protocol.js";
export type { ElementPayload, ElementOp } from "./protocol.js";
export { collectReactComponents, findFiber, parseOwnerStack } from "./fiber.js";
export function getSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current.nodeType === 1 && depth < 6) {
    let part = current.tagName.toLowerCase();
    if (current.classList.length) {
      part += "." + Array.from(current.classList).slice(0, 2).map(CSS.escape).join(".");
    }
    const parentEl: Element | null = current.parentElement;
    if (parentEl) {
      const siblings = (Array.from(parentEl.children) as Element[]).filter((c: Element) => c.tagName === current!.tagName);
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

export function getSelectorCandidates(el: Element): string[] {
  const candidates: string[] = [];
  const tag = el.tagName.toLowerCase();
  if (el.id) candidates.push(`#${CSS.escape(el.id)}`);

  const classes = Array.from(el.classList).map((c) => CSS.escape(c));
  if (classes.length > 0) {
    const subsets: string[][] = [];
    for (let size = 1; size <= classes.length; size++) {
      const combine = (start: number, current: string[]) => {
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

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || normalized.length > 500 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 60) break;
  }
  return result;
}

export function initDesignStudioRuntime(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  let editMode = false;
  let selectedElement: Element | null = null;
  let editingElement: HTMLElement | null = null;
  let parentOrigin = "*";
  let activeSessionId = "";

  const isDesignStudioElement = (el: Element | null): boolean => {
    if (!el) return false;
    try {
      return Boolean(el.closest("[data-design-studio]"));
    } catch {
      return false;
    }
  };

  const toElement = (target: EventTarget | null): Element | null => {
    if (!target) return null;
    if (target instanceof Element) return target;
    const node = target as Node;
    return node.parentElement ?? null;
  };

  /** Matched rules from linked stylesheets (skips <style> blocks and CORS-blocked sheets). */
  function collectSourceRules(el: Element): SourceRule[] | undefined {
    const result: SourceRule[] = [];
    const seen = new Set<string>();
    for (const sheet of document.styleSheets) {
      if (!sheet.href) continue;
      let rules: CSSRuleList;
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
        const key = `${sheet.href}\u0000${selectorText}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ href: sheet.href, selectorText, cssText: rule.cssText.slice(0, 2000) });
        if (result.length >= 8) return result;
      }
    }
    return result.length > 0 ? result : undefined;
  }

  /** Tailwind usage flag for the current document, cached per load. */
  let tailwindDetected: boolean | null = null;
  function detectTailwindPage(): boolean {
    if (tailwindDetected === null) tailwindDetected = scanForTailwind();
    return tailwindDetected;
  }

  function scanForTailwind(): boolean {
    try {
      if (typeof (window as { tailwind?: unknown }).tailwind === "object") return true;
      if (document.querySelector('script[src*="tailwind"]')) return true;
      let checked = 0;
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
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
      // ignore detection failures
    }
    return false;
  }

  function collect(el: Element): ElementPayload {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p).trim();
    const payload: ElementPayload = {
      selector: getSelector(el),
      selectors: getSelectorCandidates(el),
      tag: el.tagName.toLowerCase(),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      styles,
    };
    const classes = Array.from(el.classList).slice(0, 30).map((c) => c.slice(0, 100));
    if (classes.length > 0) payload.classes = classes;
    if (detectTailwindPage()) payload.tailwind = true;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 0) payload.text = text.slice(0, 2000);
    const rules = collectSourceRules(el);
    if (rules) payload.rules = rules;
    const components = collectReactComponents(el);
    if (components.length > 0) payload.component = components;
    return payload;
  }

  function postToParent(msg: RuntimeMessage): void {
    try {
      const out = activeSessionId && !(msg as { sessionId?: unknown }).sessionId
        ? { ...msg, sessionId: activeSessionId }
        : msg;
      window.parent.postMessage(out, parentOrigin || "*");
    } catch {
      // ignore
    }
  }

  function sendHoverOrSelect(type: "ds:hover" | "ds:select", el: Element): void {
    if (!editMode) return;
    if (isDesignStudioElement(el)) return;
    if (el === document.body || el === document.documentElement) return;
    const payload = collect(el);
    postToParent({ type, version: PROTOCOL_VERSION, payload, sessionId: activeSessionId || undefined });
  }

  function postOpApplied(op: ElementOp, value: string | undefined, success: boolean, reason: string | undefined, payload: ElementPayload | null | undefined, requestId?: string): void {
    postToParent({
      type: "ds:op-applied",
      version: PROTOCOL_VERSION,
      op,
      value,
      success,
      reason,
      payload,
      requestId,
      sessionId: activeSessionId || undefined,
    });
  }

  function applyElementOp(op: ElementOp, value: string | undefined, requestId?: string): void {
    if (!selectedElement) {
      postOpApplied(op, value, false, "No selected element", null, requestId);
      return;
    }
    let payload: ElementPayload | null = null;
    try {
      switch (op) {
        case "set-text": {
          const text = typeof value === "string" ? value.slice(0, 5000) : "";
          selectedElement.textContent = text;
          payload = collect(selectedElement);
          postOpApplied(op, text, true, undefined, payload, requestId);
          return;
        }
        case "delete": {
          const parent = selectedElement.parentElement;
          selectedElement.remove();
          selectedElement = parent && parent !== document.body ? parent : null;
          payload = selectedElement ? collect(selectedElement) : null;
          postOpApplied(op, undefined, true, undefined, payload, requestId);
          return;
        }
        case "duplicate": {
          const clone = selectedElement.cloneNode(true) as HTMLElement;
          if (clone.id) clone.removeAttribute("id");
          clone.setAttribute("data-ds-clone", Date.now().toString(36));
          selectedElement.after(clone);
          selectedElement = clone;
          payload = collect(clone);
          postOpApplied(op, undefined, true, undefined, payload, requestId);
          return;
        }
        case "move-up": {
          const prev = selectedElement.previousElementSibling;
          if (!prev) {
            postOpApplied(op, undefined, false, "No previous sibling", payload, requestId);
            return;
          }
          selectedElement.parentElement?.insertBefore(selectedElement, prev);
          payload = collect(selectedElement);
          postOpApplied(op, undefined, true, undefined, payload, requestId);
          return;
        }
        case "move-down": {
          const next = selectedElement.nextElementSibling;
          if (!next) {
            postOpApplied(op, undefined, false, "No next sibling", payload, requestId);
            return;
          }
          next.after(selectedElement);
          payload = collect(selectedElement);
          postOpApplied(op, undefined, true, undefined, payload, requestId);
          return;
        }
        case "set-classes": {
          if (!isValidClassListValue(value)) {
            postOpApplied(op, value, false, "Invalid class list", null, requestId);
            return;
          }
          selectedElement.setAttribute("class", value.trim());
          payload = collect(selectedElement);
          postOpApplied(op, value, true, undefined, payload, requestId);
          return;
        }
        default:
          postOpApplied(op, value, false, "Unknown op", null, requestId);
      }
    } catch {
      postOpApplied(op, value, false, "Failed to apply op", null, requestId);
    }
  }

  function postTextChanged(el: Element): void {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 5000);
    postToParent({
      type: "ds:text-changed",
      version: PROTOCOL_VERSION,
      text,
      payload: collect(el),
      sessionId: activeSessionId || undefined,
    });
  }

  function startInlineEdit(el: Element): void {
    if (!(el instanceof HTMLElement)) return;
    if (el.isContentEditable) return;
    editingElement = el;
    el.contentEditable = "true";
    el.setAttribute("data-ds-editing", "");
    el.focus({ preventScroll: true });
  }

  function endInlineEdit(cancel: boolean): void {
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

    if (data && typeof data === "object" && (data as { type?: unknown }).type === "ds:ping") {
      const ping = data as { nonce?: unknown; sessionId?: unknown; version?: unknown };
      if (typeof ping.nonce !== "string" || ping.nonce.length === 0 || ping.nonce.length > 128) return;
      if (event.origin && event.origin !== "null") parentOrigin = event.origin;
      activeSessionId = typeof ping.sessionId === "string" && ping.sessionId.length > 0 ? ping.sessionId : ping.nonce;
      postToParent({
        type: "ds:pong",
        version: PROTOCOL_VERSION,
        nonce: ping.nonce,
        sessionId: activeSessionId,
      });
      return;
    }

    if (!isRuntimeMessage(data)) return;
    const msg = data as RuntimeMessage;

    const messageSessionId = (msg as { sessionId?: unknown }).sessionId;
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
          sessionId: activeSessionId || msg.sessionId,
        });
        return;
      }
      if (typeof value !== "string" || value.length > 500) {
        postToParent({
          type: "ds:style-applied",
          version: PROTOCOL_VERSION,
          property,
          value: String(value ?? ""),
          success: false,
          reason: "Invalid value",
          requestId,
          sessionId: activeSessionId || msg.sessionId,
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
          sessionId: activeSessionId || msg.sessionId,
        });
        return;
      }
      try {
        (selectedElement as HTMLElement).style.setProperty(property, value);
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
          sessionId: activeSessionId || msg.sessionId,
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
          sessionId: activeSessionId || msg.sessionId,
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
