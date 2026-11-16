import {
  PROTOCOL_VERSION,
  type ElementOp,
  type EditableAttribute,
  type ElementPayload,
  type RuntimeMessage,
  type SourceRule,
  EDITABLE_ATTRIBUTES,
  isEditableAttribute,
  isRuntimeMessage,
  isValidClassListValue,
  STYLE_PROPS,
  STYLE_PROPERTY_PATTERN,
} from "./protocol.js";
import { collectReactComponents } from "./fiber.js";
import { debugPerfEnabled, formatPerfSummary, PerfCollector } from "./perf.js";

export { PROTOCOL_VERSION } from "./protocol.js";
export type { ElementPayload, ElementOp } from "./protocol.js";
export { collectReactComponents, findFiber, parseOwnerStack } from "./fiber.js";

declare global {
  interface Window {
    /** Re-injection guard (see initDesignStudioRuntime). */
    __dsRuntimeInitialized?: boolean;
  }
}
/** DOM properties mirrored when the matching attribute is edited (`set-attribute`). */
const LIVE_PROPERTY_BY_ATTRIBUTE: Record<string, string> = {
  checked: "checked",
  disabled: "disabled",
  required: "required",
  multiple: "multiple",
  readonly: "readOnly",
  value: "value",
};

export function getSelector(el: Element): string {
  if (el.id) {
    const idSelector = `#${CSS.escape(el.id)}`;
    if (idSelector.length <= 500) return idSelector;
  }
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === 1) {
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
    if (current === document.body || current === null) break;
  }
  while (parts.length > 1 && parts.join(" > ").length > 500) parts.shift();
  return parts.join(" > ");
}

export function getSelectorCandidates(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const path = getSelector(el);
  const seen = new Set<string>();
  const result: string[] = [];
  const maxCandidates = 19; // Reserve one slot for the exact DOM path below.
  const add = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized || normalized.length > 500 || seen.has(normalized) || result.length >= maxCandidates) return;
    seen.add(normalized);
    result.push(normalized);
  };

  if (el.id) add(`#${CSS.escape(el.id)}`);
  const classes = Array.from(el.classList).map((c) => CSS.escape(c));
  for (const className of classes) {
    add(`.${className}`);
    add(`${tag}.${className}`);
    if (result.length >= maxCandidates) break;
  }

  for (let left = 0; left < classes.length && result.length < maxCandidates; left++) {
    for (let right = left + 1; right < classes.length && result.length < maxCandidates; right++) {
      const pair = `.${classes[left]}.${classes[right]}`;
      add(pair);
      add(`${tag}${pair}`);
    }
  }
  if (classes.length === 0) add(tag);

  if (!seen.has(path)) {
    result.push(path);
  }
  return result;
}

/**
 * P2-13 producers: the runtime previously declared `ds:runtime-ready` and
 * `ds:runtime-error` without ever sending them, so the webview handshake
 * depended on ping timeouts. The announcement carries no page data and is only
 * sent with a concrete target origin (never "*"): when Chromium exposes the
 * immediate parent origin via `location.ancestorOrigins` (real VS Code
 * webviews) the webview learns about the runtime immediately; otherwise the
 * ping/pong handshake stays as fallback.
 */
export function postRuntimeAnnouncement(
  kind: "ready" | "error",
  errorMessage?: string,
  via: { targetOrigin?: string | null } = {}
): void {
  if (typeof window === "undefined") return;
  let targetOrigin = via.targetOrigin;
  if (targetOrigin === undefined) {
    try {
      const origins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
      targetOrigin = origins && origins.length > 0 ? String(origins[origins.length - 1]) : null;
    } catch {
      targetOrigin = null;
    }
  }
  // Top-level page (no embedder): nothing meaningful to announce to.
  if (via.targetOrigin === undefined && window.parent === window) return;
  if (!targetOrigin || targetOrigin === "*") return;
  try {
    window.parent.postMessage(
      kind === "ready"
        ? { type: "ds:runtime-ready", version: PROTOCOL_VERSION }
        : { type: "ds:runtime-error", version: PROTOCOL_VERSION, message: (errorMessage ?? "Runtime crashed").slice(0, 500) },
      targetOrigin
    );
  } catch {
    // Handshake falls back to ping/pong.
  }
}

/**
 * Matched source rules from the given stylesheets, walking grouping rules
 * (@media/@supports/@layer/@container) recursively. Shared export so the
 * walker is unit-testable without a live document.
 */
const MAX_RULES = 8;
const MAX_SCANNED = 1500;
const MAX_CSS_TEXT = 2000;
type WalkableSheet = { href?: string | null; cssRules?: { length?: number } };

function isStyleRuleLike(rule: unknown): rule is { selectorText: string; cssText: string } {
  if (typeof rule !== "object" || rule === null) return false;
  const r = rule as { selectorText?: unknown; cssText?: unknown };
  return typeof r.selectorText === "string" && typeof r.cssText === "string";
}

function hasChildRules(rule: unknown): rule is { cssRules: CSSRuleList } {
  if (typeof rule !== "object" || rule === null) return false;
  const r = rule as { cssRules?: unknown };
  return typeof r.cssRules === "object" && r.cssRules !== null && typeof (r.cssRules as { length?: unknown }).length === "number";
}

export function collectSourceRulesFromStylesheets(
  sheets: Iterable<WalkableSheet>,
  el: Element,
  opts: { maxRules?: number; maxScanned?: number } = {}
): SourceRule[] | undefined {
  const maxRules = opts.maxRules ?? MAX_RULES;
  const maxScanned = opts.maxScanned ?? MAX_SCANNED;
  const result: SourceRule[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  for (const sheet of sheets) {
    const sheetHref = sheet.href;
    if (!sheetHref) continue;
    const rules: CSSRuleList | undefined = sheet.cssRules as CSSRuleList | undefined;
    if (!rules) continue;
    const walk = (list: CSSRuleList): void => {
      for (const rule of Array.from(list)) {
        if (scanned >= maxScanned) return;
        scanned++;
        if (hasChildRules(rule)) {
          walk(rule.cssRules);
          if (scanned >= maxScanned) return;
          continue;
        }
        if (!isStyleRuleLike(rule)) continue;
        const selectorText = rule.selectorText;
        let matches = false;
        try {
          matches = el.matches(selectorText);
        } catch {
          continue;
        }
        if (!matches) continue;
        const key = sheet.href + "\u0000" + selectorText + "\u0000" + rule.cssText;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ href: sheetHref, selectorText, cssText: rule.cssText.slice(0, MAX_CSS_TEXT) });
        if (result.length >= maxRules) return;
      }
    };
    walk(rules);
    if (result.length >= maxRules) break;
  }
  return result.length > 0 ? result : undefined;
}

/** Matched rules from linked stylesheets (skips <style> blocks and CORS-blocked sheets). */
function collectSourceRules(el: Element): SourceRule[] | undefined {
  const sheets: WalkableSheet[] = [];
  for (const sheet of document.styleSheets) {
    if (!sheet.href) continue;
    try {
      void sheet.cssRules;
    } catch {
      continue;
    }
    sheets.push(sheet);
  }
  return collectSourceRulesFromStylesheets(sheets, el);
}

export function initDesignStudioRuntime(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // Re-injection guard: a duplicated runtime script (double legacy injection,
  // HMR, future injection paths) must never create a second runtime instance
  // with duplicated listeners, outlines and history patches.
  if (window.__dsRuntimeInitialized) return;
  window.__dsRuntimeInitialized = true;

  let editMode = false;
  let selectedElement: Element | null = null;
  let hoveredElement: Element | null = null;
  // Trusted parent origin, captured from the first accepted ds:ping. Null
  // until then: no session means nothing to report, and nothing may be sent.
  let parentOrigin: string | null = null;
  let activeSessionId = "";
  let hoverOutline: HTMLDivElement | null = null;
  let selectionOutline: HTMLDivElement | null = null;
  let outlineFrame = 0;
  let perfEnabled = false;
  const runtimeScript = document.querySelector<HTMLScriptElement>('script[data-design-studio="1"]');
  // Opt-in diagnostics for the select pipeline; see docs/IMPLEMENTATION_PLAN.md (EPIC E/H4).
  perfEnabled = debugPerfEnabled(window.location.search);
  const upstreamOrigin = (() => {
    // Explicit injection attribute is the primary source (proxied and project
    // pages); fall back to the document base/own origin so the browse-mode
    // link policy stays alive when an app embeds the runtime itself.
    const raw = runtimeScript?.dataset.upstreamOrigin;
    if (raw) {
      try {
        return new URL(raw).origin;
      } catch {
        // fall through
      }
    }
    const base = document.querySelector("base[href]");
    if (base) {
      try {
        const origin = new URL(base.getAttribute("href")!, window.location.href).origin;
        if (origin && origin !== "null") return origin;
      } catch {
        // fall through
      }
    }
    try {
      return window.location.origin && window.location.origin !== "null" ? window.location.origin : null;
    } catch {
      return null;
    }
  })();

  // The preview host serves the app both at its own origin (sticky bare paths,
  // /proxy/ routes) and at the upstream origin: a link is navigable when it
  // targets either of them. Everything else stays blocked (NAV-01).
  const previewOrigin = (() => {
    try {
      const origin = window.location.origin;
      return origin && origin !== "null" ? origin : null;
    } catch {
      return null;
    }
  })();

  const parentOriginsAllowlist: string[] = (() => {
    const raw = runtimeScript?.dataset.parentOrigins;
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  })();

  const isTrustedParentOrigin = (origin: string): boolean => {
    // VS Code webview parents carry a vscode-webview://<id> origin.
    if (/^vscode-webview(?::|$)/.test(origin)) return true;
    // Explicit allowlist passed at injection time.
    if (parentOriginsAllowlist.includes(origin)) return true;
    // Same-origin embedding (runtime embedded by the page itself).
    try {
      return origin === window.location.origin;
    } catch {
      return false;
    }
  };

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

  const canSelect = (el: Element | null): el is Element =>
    Boolean(el) && !isDesignStudioElement(el) && el !== document.body && el !== document.documentElement;

  function ensureOutlines(): void {
    if (!document.body || (hoverOutline && selectionOutline)) return;
    const makeOutline = (color: string, fill: string): HTMLDivElement => {
      const outline = document.createElement("div");
      outline.setAttribute("data-design-studio", "1");
      outline.setAttribute("aria-hidden", "true");
      outline.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "display:none",
        "pointer-events:none",
        "box-sizing:border-box",
        `border:2px solid ${color}`,
        `background:${fill}`,
        "border-radius:2px",
        "transition:transform 45ms linear,width 45ms linear,height 45ms linear",
      ].join(";");
      document.body.appendChild(outline);
      return outline;
    };
    hoverOutline = makeOutline("rgba(90, 157, 255, .95)", "rgba(90, 157, 255, .18)");
    selectionOutline = makeOutline("rgba(255, 170, 70, 1)", "rgba(255, 170, 70, .12)");
  }

  function positionOutline(outline: HTMLDivElement | null, el: Element | null): void {
    if (!outline) return;
    if (!editMode || !el || !el.isConnected) {
      outline.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      outline.style.display = "none";
      return;
    }
    outline.style.display = "block";
    outline.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    outline.style.width = `${Math.round(rect.width)}px`;
    outline.style.height = `${Math.round(rect.height)}px`;
  }

  function scheduleOutlineUpdate(): void {
    if (outlineFrame) return;
    outlineFrame = window.requestAnimationFrame(() => {
      outlineFrame = 0;
      if (!editMode) return;
      ensureOutlines();
      positionOutlinesNow();
      // P2-6: keep the webview popup anchored — repaint the fresh rect on scroll/resize.
      if (selectedElement) {
        const rect = selectedElement.getBoundingClientRect();
        postToParent({
          type: "ds:rect",
          version: PROTOCOL_VERSION,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        });
      }
    });
  }

  /**
   * Position outlines synchronously from the event handler, not via rAF:
   * rAF can be throttled to zero for cross-origin iframes in hosted webviews
   * (VS Code/Electron occlusion), which would leave hover/selection invisible.
   * The work is a single getBoundingClientRect plus two style writes, so it
   * is cheap enough to run on the pointer path. rAF remains only for
   * scroll/resize following.
   */
  function positionOutlinesNow(): void {
    positionOutline(hoverOutline, hoveredElement);
    positionOutline(selectionOutline, selectedElement);
  }

  function hideOutlines(): void {
    if (outlineFrame) window.cancelAnimationFrame(outlineFrame);
    outlineFrame = 0;
    if (hoverOutline) hoverOutline.style.display = "none";
    if (selectionOutline) selectionOutline.style.display = "none";
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

  function buildPayload(el: Element, perf: PerfCollector | null): ElementPayload {
    const stage = <T,>(name: string, fn: () => T): T => (perf ? perf.stage(name, fn) : fn());
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p).trim();
    const identity = stage("selectors", () => ({ selector: getSelector(el), selectors: getSelectorCandidates(el) }));
    const payload: ElementPayload = {
      selector: identity.selector,
      selectors: identity.selectors,
      tag: el.tagName.toLowerCase(),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      styles,
    };
    const classes = stage("classes", () => Array.from(el.classList).slice(0, 30).map((c) => c.slice(0, 100)));
    if (classes.length > 0) payload.classes = classes;
    const attributes = stage("attributes", () => {
      const attrs: Record<string, string> = {};
      for (const name of EDITABLE_ATTRIBUTES) {
        if (el.hasAttribute(name)) attrs[name] = (el.getAttribute(name) ?? "").slice(0, 2000);
      }
      return attrs;
    });
    if (Object.keys(attributes).length > 0) payload.attributes = attributes;
    if (detectTailwindPage()) payload.tailwind = true;
    const text = stage("text", () => readElementText(el));
    if (text.length > 0) payload.text = text.slice(0, 2000);
    const rules = stage("rules", () => collectSourceRules(el));
    if (rules) payload.rules = rules;
    const components = stage("components", () => collectReactComponents(el));
    if (components.length > 0) payload.component = components;
    return payload;
  }

  function collect(el: Element): ElementPayload {
    if (!perfEnabled) return buildPayload(el, null);
    const perf = new PerfCollector("select");
    const payload = buildPayload(el, perf);
    console.debug(formatPerfSummary(perf.finish()));
    return payload;
  }

  function readElementText(el: Element): string {
    if (el instanceof HTMLTextAreaElement) return el.value.trim();
    if (el instanceof HTMLInputElement) return el.type === "password" ? "" : el.value.trim();
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function postToParent(msg: RuntimeMessage): void {
    // Without a trusted parent origin (no accepted ping yet) nothing is sent:
    // replying to "*" would leak element/page data to any surrounding page.
    if (!parentOrigin) return;
    try {
      const out = activeSessionId && !(msg as { sessionId?: unknown }).sessionId
        ? { ...msg, sessionId: activeSessionId }
        : msg;
      window.parent.postMessage(out, parentOrigin);
    } catch {
      // ignore
    }
  }

  function sendSelection(el: Element): void {
    if (!editMode || !canSelect(el)) return;
    selectedElement = el;
    hoveredElement = el;
    ensureOutlines();
    positionOutlinesNow();
    postToParent({ type: "ds:select", version: PROTOCOL_VERSION, payload: collect(el), sessionId: activeSessionId || undefined });
  }

  function currentApplicationPath(): string {
    const current = new URL(window.location.href);
    const structuredProxy = /^\/proxy\/(https?)\/([^/]+)(\/.*)?$/i.exec(current.pathname);
    if (structuredProxy) {
      try {
        const upstream = new URL(`${structuredProxy[1]}://${structuredProxy[2]}${structuredProxy[3] ?? "/"}${current.search}${current.hash}`);
        return `${upstream.pathname}${upstream.search}${upstream.hash}`;
      } catch {
        // Fall through to support old preview links and ordinary app routes.
      }
    }
    const proxyMarker = "/proxy/";
    const proxyIndex = current.pathname.indexOf(proxyMarker);
    if (proxyIndex !== -1) {
      const target = current.pathname.slice(proxyIndex + proxyMarker.length) + current.search + current.hash;
      try {
        const upstream = new URL(target);
        return `${upstream.pathname}${upstream.search}${upstream.hash}`;
      } catch {
        // A malformed proxy URL falls back to the visible path below.
      }
    }
    return `${current.pathname}${current.search}${current.hash}`;
  }

  function notifyNavigation(): void {
    if (!activeSessionId) return;
    postToParent({
      type: "ds:navigate",
      version: PROTOCOL_VERSION,
      path: currentApplicationPath(),
      sessionId: activeSessionId,
    });
  }

  function postOpApplied(
    op: ElementOp,
    value: string | undefined,
    success: boolean,
    reason: string | undefined,
    payload: ElementPayload | null | undefined,
    requestId?: string,
    attribute?: EditableAttribute
  ): void {
    postToParent({
      type: "ds:op-applied",
      version: PROTOCOL_VERSION,
      op,
      value,
      ...(attribute ? { attribute } : {}),
      success,
      reason,
      payload,
      requestId,
      sessionId: activeSessionId || undefined,
    });
  }

  function applyElementOp(op: ElementOp, value: string | undefined, requestId?: string, attribute?: EditableAttribute): void {
    if (!selectedElement) {
      postOpApplied(op, value, false, "No selected element", null, requestId);
      return;
    }
    let payload: ElementPayload | null = null;
    try {
      switch (op) {
        case "set-text": {
          const text = typeof value === "string" ? value.slice(0, 5000) : "";
          if (selectedElement instanceof HTMLTextAreaElement || selectedElement instanceof HTMLInputElement) {
            if (selectedElement instanceof HTMLInputElement && selectedElement.type === "password") {
              postOpApplied(op, text, false, "Password values cannot be edited", null, requestId);
              return;
            }
            selectedElement.value = text;
            selectedElement.setAttribute("value", text);
          } else {
            selectedElement.textContent = text;
          }
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
          // Descendant ids must not be duplicated in the DOM.
          for (const child of clone.querySelectorAll("[id]")) child.removeAttribute("id");
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
        case "set-attribute": {
          if (!isEditableAttribute(attribute) || typeof value !== "string" || value.length > 2000) {
            postOpApplied(op, value, false, "Invalid attribute", null, requestId, attribute);
            return;
          }
          if (
            (attribute === "href" || attribute === "src") &&
            value !== "" &&
            /^(javascript|vbscript)\s*:/i.test(value.trim())
          ) {
            postOpApplied(op, value, false, "Blocked URL scheme", null, requestId, attribute);
            return;
          }
          if (value === "") {
            selectedElement.removeAttribute(attribute);
          } else {
            selectedElement.setAttribute(attribute, value);
          }
          // Boolean attributes and `value` are mirrored to the live DOM property
          // so the preview reacts immediately, not only on later attribute reads.
          const liveProperty = LIVE_PROPERTY_BY_ATTRIBUTE[attribute];
          if (liveProperty) {
            const live = selectedElement as unknown as Record<string, unknown>;
            if (liveProperty in selectedElement) {
              live[liveProperty] = liveProperty === "value" ? value : value !== "";
            }
          }
          payload = collect(selectedElement);
          postOpApplied(op, value, true, undefined, payload, requestId, attribute);
          return;
        }
        default:
          postOpApplied(op, value, false, "Unknown op", null, requestId);
      }
    } catch {
      postOpApplied(op, value, false, "Failed to apply op", null, requestId);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    // P1-1: strict origin gate. Pings and control messages are accepted only
    // from trusted parents (VS Code webview, injected allowlist, same-origin);
    // "null"/sandboxed and foreign origins can never start a session.
    if (!event.origin || event.origin === "null" || !isTrustedParentOrigin(event.origin)) return;
    const data = event.data;

    if (data && typeof data === "object" && (data as { type?: unknown }).type === "ds:ping") {
      const ping = data as { nonce?: unknown; sessionId?: unknown; version?: unknown };
      if (typeof ping.nonce !== "string" || ping.nonce.length === 0 || ping.nonce.length > 128) return;
      // Reply goes to the ping's exact origin — never "*".
      parentOrigin = event.origin;
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

    if (msg.type === "ds:navigate-history") {
      if (activeSessionId && msg.sessionId !== activeSessionId) return;
      if (msg.direction === "back") window.history.back();
      else window.history.forward();
      return;
    }
    if (msg.type === "ds:reload") {
      if (activeSessionId && msg.sessionId !== activeSessionId) return;
      window.location.reload();
      return;
    }

    if (msg.type === "ds:set-mode") {
      if (activeSessionId && msg.sessionId !== activeSessionId) return;
      editMode = Boolean(msg.enabled);
      if (editMode) {
        ensureOutlines();
        scheduleOutlineUpdate();
      } else {
        // Leaving edit mode clears all selection visuals so no stale outline
        // survives a later re-entry.
        hoveredElement = null;
        selectedElement = null;
        hideOutlines();
      }
      postToParent({ type: "ds:mode-changed", version: PROTOCOL_VERSION, enabled: editMode, sessionId: activeSessionId || msg.sessionId });
      notifyNavigation();
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
      applyElementOp(msg.op, msg.value, msg.requestId, msg.attribute);
      return;
    }
  });

  const originalPushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    const result = originalPushState(...args);
    notifyNavigation();
    return result;
  };
  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    const result = originalReplaceState(...args);
    notifyNavigation();
    return result;
  };
  window.addEventListener("popstate", notifyNavigation);
  window.addEventListener("hashchange", notifyNavigation);

  window.addEventListener("resize", scheduleOutlineUpdate);
  window.addEventListener("scroll", scheduleOutlineUpdate, true);

  document.addEventListener("pointermove", (event) => {
    if (!editMode) return;
    const target = toElement(event.target);
    if (!canSelect(target) || target === hoveredElement) return;
    hoveredElement = target;
    ensureOutlines();
    positionOutlinesNow();
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!editMode) return;
    const target = toElement(event.target);
    if (!canSelect(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendSelection(target);
  }, true);

  document.addEventListener("click", (event) => {
    const target = toElement(event.target);
    if (editMode) {
      if (canSelect(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !upstreamOrigin || anchor.hasAttribute("download")) return;
    // Predictable link policy for the preview iframe (browse mode):
    // - links targeting the upstream origin OR the preview host origin (the
    //   document's own origin: sticky bare paths, /proxy/ routes) navigate
    //   inside the preview frame (NAV-01);
    // - links whose target cannot be served by the preview host (other origins,
    //   dangerous schemes) are blocked with a UI notification.
    let href: URL;
    try {
      href = new URL(anchor.href, window.location.href);
    } catch {
      // Keep the native behavior when the link cannot be parsed.
      return;
    }
    const dangerousScheme = ["javascript:", "data:", "vbscript:", "blob:", "about:"].includes(href.protocol);
    if (!dangerousScheme && href.protocol !== "http:" && href.protocol !== "https:") return; // mailto:, tel: — native
    const escapesFrame = Boolean(anchor.target) && anchor.target !== "_self";
    const navigable =
      href.origin === upstreamOrigin ||
      (previewOrigin !== null && href.origin === previewOrigin);
    if (dangerousScheme || !navigable || escapesFrame) {
      event.preventDefault();
      postToParent({
        type: "ds:navigate-blocked",
        version: PROTOCOL_VERSION,
        url: href.toString().slice(0, 2048),
        sessionId: activeSessionId || undefined,
      });
      return;
    }
    event.preventDefault();
    window.location.assign(`${href.pathname}${href.search}${href.hash}`);
  }, true);
}

if (typeof window !== "undefined") {
  try {
    initDesignStudioRuntime();
    postRuntimeAnnouncement("ready");
  } catch (err) {
    try {
      postRuntimeAnnouncement("error", err instanceof Error ? err.message : String(err));
    } catch {
      // Final fallback: nothing else can be done.
    }
  }
}
