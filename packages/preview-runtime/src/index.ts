export interface ElementPayload {
  selector: string;
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
}

export function initDesignStudioRuntime(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  let editMode = false;
  let selectedElement: Element | null = null;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "ds:set-mode") {
      editMode = Boolean(data.enabled);
    }
    if (data.type === "ds:apply-style" && selectedElement) {
      const { property, value } = data;
      if (typeof property === "string") {
        (selectedElement as HTMLElement).style.setProperty(property, String(value ?? ""));
        const payload = collect(selectedElement);
        window.parent.postMessage({ type: "ds:select", version: "1", payload }, "*");
      }
    }
  });

  function getSelector(el: Element): string {
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
      if (current === document.body) break;
    }
    return parts.join(" > ");
  }

  function collect(el: Element): ElementPayload {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    const props = ["display", "position", "width", "height", "margin", "padding", "color", "backgroundColor", "fontSize", "fontFamily", "border", "borderRadius", "opacity"];
    for (const p of props) styles[p] = cs.getPropertyValue(p);
    return {
      selector: getSelector(el),
      tag: el.tagName.toLowerCase(),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      styles,
    };
  }

  function send(type: string, el: Element): void {
    if (!editMode) return;
    if (el.closest("[data-design-studio]")) return;
    const payload = collect(el);
    window.parent.postMessage({ type, version: "1", payload }, "*");
  }

  let lastHover = 0;
  document.addEventListener("mouseover", (e) => {
    const now = Date.now();
    if (now - lastHover < 100) return;
    lastHover = now;
    const target = e.target as Element | null;
    if (!target || target === document.body) return;
    send("ds:hover", target);
  }, true);

  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    if (!target) return;
    selectedElement = target;
    send("ds:select", target);
  }, true);
}

if (typeof window !== "undefined") {
  console.log("Design Studio runtime loaded");
  initDesignStudioRuntime();
}