import {
  PROTOCOL_VERSION,
  type ElementPayload,
  type RuntimeMessage,
  isRuntimeMessage,
  STYLE_PROPS,
  STYLE_PROPERTY_PATTERN,
} from "./protocol.js";

export { PROTOCOL_VERSION } from "./protocol.js";
export type { ElementPayload } from "./protocol.js";

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

  function collect(el: Element): ElementPayload {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p).trim();
    return {
      selector: getSelector(el),
      selectors: getSelectorCandidates(el),
      tag: el.tagName.toLowerCase(),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      styles,
    };
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
      if (typeof value !== "string" || value.length === 0 || value.length > 500) {
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
