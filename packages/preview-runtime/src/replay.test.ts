/*!
 * IMP-A: edit survival — ds:replay applies journal edits by selector without a
 * selection, the reapply registry restores drifted values on the mutation
 * debounce, and forget:true (undo) drops entries permanently.
 */
// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://127.0.0.1:9533/replay"}
import { describe, it, expect, vi } from "vitest";
import { PROTOCOL_VERSION } from "./protocol";

const trustedOrigin = "vscode-webview://webview-replay";

function receive(data: unknown, origin: string): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: window as unknown as MessageEventSource }));
}

function withPostSpy<T>(fn: () => T): Array<{ msg: Record<string, unknown>; target: string }> {
  const posted: Array<{ msg: Record<string, unknown>; target: string }> = [];
  const spy = vi
    .spyOn(window, "postMessage")
    .mockImplementation(((msg: unknown, target: string) => {
      posted.push({ msg: msg as Record<string, unknown>, target });
    }) as typeof window.postMessage);
  try {
    fn();
    return posted;
  } finally {
    spy.mockRestore();
  }
}

// Same spawn machinery as index.test.ts: fresh module instance per runtime,
// stale listeners removed so earlier instances never double-handle messages.
interface RuntimeListener {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
}
const runtimeListeners: RuntimeListener[] = [];

function captureFlag(opts: boolean | AddEventListenerOptions | undefined): boolean {
  if (typeof opts === "boolean") return opts;
  return Boolean(opts?.capture);
}

function removeRuntimeListeners(): void {
  while (runtimeListeners.length > 0) {
    const { target, type, listener, capture } = runtimeListeners.pop()!;
    target.removeEventListener(type, listener, { capture });
  }
}

async function spawnRuntime(): Promise<void> {
  window.dispatchEvent(new Event("pagehide"));
  removeRuntimeListeners();
  vi.resetModules();
  (window as unknown as { __dsRuntimeInitialized?: boolean }).__dsRuntimeInitialized = false;
  document.head.innerHTML = '<script data-design-studio="1" src="/__ds-runtime.js"></script>';
  const winSpy = vi.spyOn(window, "addEventListener");
  const docSpy = vi.spyOn(document, "addEventListener");
  try {
    const mod = await import("./index.js");
    mod.initDesignStudioRuntime();
  } finally {
    for (const [type, listener, opts] of winSpy.mock.calls) {
      runtimeListeners.push({ target: window, type, listener, capture: captureFlag(opts) });
    }
    for (const [type, listener, opts] of docSpy.mock.calls) {
      runtimeListeners.push({ target: document, type, listener, capture: captureFlag(opts) });
    }
    winSpy.mockRestore();
    docSpy.mockRestore();
  }
}

let sessionCounter = 0;
async function spawnAndHandshake(): Promise<string> {
  await spawnRuntime();
  const session = `replay-${++sessionCounter}`;
  withPostSpy(() => receive({ type: "ds:ping", version: PROTOCOL_VERSION, nonce: session, sessionId: session }, trustedOrigin));
  return session;
}

function send(session: string, extra: Record<string, unknown>): Array<{ msg: Record<string, unknown>; target: string }> {
  return withPostSpy(() => receive({ version: PROTOCOL_VERSION, sessionId: session, ...extra }, trustedOrigin));
}

function replayed(posted: Array<{ msg: Record<string, unknown>; target: string }>): Record<string, unknown> {
  const msg = posted.find((p) => p.msg.type === "ds:replayed");
  expect(msg).toBeDefined();
  return msg!.msg;
}

const tick = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Attribute/style writes are not observed (childList/characterData only) — force a tick. */
function triggerDomMutation(): void {
  const node = document.createElement("div");
  document.body.appendChild(node);
  node.remove();
}

function dispatchPointerDown(el: Element): void {
  const down = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(down, "target", { value: el });
  withPostSpy(() => document.dispatchEvent(down));
}

/** Stub CSS.supports (jsdom may not implement it) without touching CSS.escape. */
function withCSSSupports<T>(supports: (property: string, value: string) => boolean, fn: () => T): T {
  const css = (window as unknown as { CSS: Record<string, unknown> }).CSS;
  const original = css.supports;
  css.supports = supports;
  try {
    return fn();
  } finally {
    if (original === undefined) delete css.supports;
    else css.supports = original;
  }
}

describe("ds:replay (IMP-A)", () => {
  it("applies style/text/classes/attribute by selector without any selection", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="s">orig</div><p id="t">old</p><span id="c" class="x"></span><a id="a" href="/old">l</a>';
    const posted = send(session, {
      type: "ds:replay",
      edits: [
        { kind: "style", selector: "#s", property: "color", value: "blue" },
        { kind: "text", selector: "#t", value: "New" },
        { kind: "classes", selector: "#c", value: "a b" },
        { kind: "attribute", selector: "#a", property: "href", value: "/new" },
      ],
    });
    expect(replayed(posted)).toMatchObject({ applied: 4, skipped: 0, sessionId: session });
    // One summary reply only: no per-edit acks, no selection, no badges.
    expect(posted).toHaveLength(1);
    expect(document.querySelectorAll("body > [data-design-studio]").length).toBe(0);
    expect((document.getElementById("s") as HTMLElement).style.getPropertyValue("color")).toBe("blue");
    expect(document.getElementById("t")!.textContent).toBe("New");
    expect(document.getElementById("c")!.getAttribute("class")).toBe("a b");
    expect(document.getElementById("a")!.getAttribute("href")).toBe("/new");
  });

  it("counts missing, malformed and non-selectable selectors as skipped", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="ok">x</div>';
    const posted = send(session, {
      type: "ds:replay",
      edits: [
        { kind: "style", selector: "#ok", property: "color", value: "blue" },
        { kind: "style", selector: "#gone", property: "color", value: "red" },
        { kind: "style", selector: ">>>", property: "color", value: "red" },
        { kind: "style", selector: "body", property: "color", value: "red" },
      ],
    });
    expect(replayed(posted)).toMatchObject({ applied: 1, skipped: 3 });
    expect((document.getElementById("ok") as HTMLElement).style.getPropertyValue("color")).toBe("blue");
  });

  it("counts a failed apply (unsupported CSS value) as skipped", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="ok">x</div>';
    const posted = withCSSSupports(
      (property, value) => !(property === "color" && value === "not-a-color"),
      () =>
        send(session, {
          type: "ds:replay",
          edits: [
            { kind: "style", selector: "#ok", property: "color", value: "not-a-color" },
            { kind: "style", selector: "#ok", property: "color", value: "blue" },
          ],
        })
    );
    expect(replayed(posted)).toMatchObject({ applied: 1, skipped: 1 });
    expect((document.getElementById("ok") as HTMLElement).style.getPropertyValue("color")).toBe("blue");
  });

  it("rejects a foreign session id and a stale protocol version", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="ok">x</div>';
    const foreign = withPostSpy(() =>
      receive({ type: "ds:replay", version: PROTOCOL_VERSION, edits: [], sessionId: "intruder" }, trustedOrigin)
    );
    expect(foreign.some((p) => p.msg.type === "ds:replayed")).toBe(false);
    const stale = withPostSpy(() =>
      receive({ type: "ds:replay", version: "8", edits: [], sessionId: session }, trustedOrigin)
    );
    expect(stale.some((p) => p.msg.type === "ds:replayed")).toBe(false);
  });

  it("forget:true applies the before-value and drops the entry (undo survives drift)", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="f">x</div>';
    const target = document.getElementById("f") as HTMLElement;
    expect(replayed(send(session, { type: "ds:replay", edits: [{ kind: "style", selector: "#f", property: "color", value: "blue" }] })).applied).toBe(1);
    expect(target.style.getPropertyValue("color")).toBe("blue");
    // Undo: before-value "" removes the override AND the registry entry.
    expect(replayed(send(session, { type: "ds:replay", edits: [{ kind: "style", selector: "#f", property: "color", value: "", forget: true }] })).applied).toBe(1);
    expect(target.style.getPropertyValue("color")).toBe("");
    // External drift after the undo must NOT be re-applied on the mutation tick.
    target.style.setProperty("color", "red");
    triggerDomMutation();
    await tick();
    expect(target.style.getPropertyValue("color")).toBe("red");
  });

  it("restores replayed style/text/classes/attribute after external drift + the 100ms debounce", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="s">orig</div><p id="t">old</p><span id="c"></span><a id="a" title="old">l</a>';
    send(session, {
      type: "ds:replay",
      edits: [
        { kind: "style", selector: "#s", property: "color", value: "blue" },
        { kind: "text", selector: "#t", value: "New" },
        { kind: "classes", selector: "#c", value: "a b" },
        { kind: "attribute", selector: "#a", property: "title", value: "Tip" },
      ],
    });
    // Simulate a React re-render wiping every edit.
    const s = document.getElementById("s") as HTMLElement;
    const t = document.getElementById("t")!;
    const c = document.getElementById("c")!;
    const a = document.getElementById("a")!;
    s.style.setProperty("color", "red");
    t.firstChild!.nodeValue = "wiped";
    c.setAttribute("class", "z");
    a.removeAttribute("title");
    triggerDomMutation();
    await tick();
    expect(s.style.getPropertyValue("color")).toBe("blue");
    expect(t.textContent).toBe("New");
    expect(c.getAttribute("class")).toBe("a b");
    expect(a.getAttribute("title")).toBe("Tip");
    // A second observer pass is a no-op: values stay stable, nothing is posted.
    const later: Array<Record<string, unknown>> = [];
    const spy = vi
      .spyOn(window, "postMessage")
      .mockImplementation(((msg: unknown) => {
        later.push(msg as Record<string, unknown>);
      }) as typeof window.postMessage);
    try {
      triggerDomMutation();
      await tick();
    } finally {
      spy.mockRestore();
    }
    expect(later.some((m) => m.type === "ds:replayed")).toBe(false);
    expect(s.style.getPropertyValue("color")).toBe("blue");
    expect(t.textContent).toBe("New");
  });

  it("keeps entries for temporarily detached elements (HMR) and restores them on reattach", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = '<div id="wrap"><p id="t">old</p></div>';
    send(session, { type: "ds:replay", edits: [{ kind: "text", selector: "#t", value: "New" }] });
    const wrap = document.getElementById("wrap")!;
    const t = document.getElementById("t")!;
    // Detach the subtree: the tick must skip without deleting the entry.
    wrap.remove();
    triggerDomMutation();
    await tick();
    // Reattach with wiped content (fresh React render).
    t.firstChild!.nodeValue = "wiped";
    document.body.appendChild(wrap);
    await tick();
    expect(document.getElementById("t")!.textContent).toBe("New");
  });

  it("records a normal ds:apply-style + selection and restores it after drift", async () => {
    const session = await spawnAndHandshake();
    send(session, { type: "ds:set-mode", enabled: true });
    document.body.innerHTML = '<div id="styled">x</div>';
    const styled = document.getElementById("styled") as HTMLElement;
    dispatchPointerDown(styled);
    const posted = send(session, { type: "ds:apply-style", property: "color", value: "blue", requestId: "r1" });
    // Existing ack shape is unchanged.
    expect(posted.filter((p) => p.msg.type === "ds:style-applied").at(-1)!.msg).toMatchObject({ success: true, property: "color", requestId: "r1" });
    styled.style.setProperty("color", "red");
    triggerDomMutation();
    await tick();
    expect(styled.style.getPropertyValue("color")).toBe("blue");
  });

  it("records a normal set-text op and restores it after drift", async () => {
    const session = await spawnAndHandshake();
    send(session, { type: "ds:set-mode", enabled: true });
    document.body.innerHTML = '<div id="card">orig</div>';
    const card = document.getElementById("card")!;
    dispatchPointerDown(card);
    const posted = send(session, { type: "ds:apply-op", op: "set-text", value: "Changed", requestId: "t1" });
    expect(posted.find((p) => p.msg.type === "ds:op-applied")!.msg).toMatchObject({ op: "set-text", success: true, value: "Changed", requestId: "t1" });
    card.firstChild!.nodeValue = "wiped";
    await tick();
    expect(card.textContent).toBe("Changed");
  });

  it("bounds the registry to 200 entries and evicts the oldest", async () => {
    const session = await spawnAndHandshake();
    document.body.innerHTML = Array.from({ length: 201 }, (_, i) => `<div id="e${i}">x</div>`).join("");
    const edit = (i: number) => ({ kind: "style", selector: `#e${i}`, property: "color", value: "blue" });
    expect(replayed(send(session, { type: "ds:replay", edits: Array.from({ length: 200 }, (_, i) => edit(i)) })).applied).toBe(200);
    expect(replayed(send(session, { type: "ds:replay", edits: [edit(200)] })).applied).toBe(1);
    // e0 was evicted; e200 is the newest entry.
    const first = document.getElementById("e0") as HTMLElement;
    const last = document.getElementById("e200") as HTMLElement;
    first.style.setProperty("color", "red");
    last.style.setProperty("color", "red");
    triggerDomMutation();
    await tick();
    expect(first.style.getPropertyValue("color")).toBe("red");
    expect(last.style.getPropertyValue("color")).toBe("blue");
  });
});