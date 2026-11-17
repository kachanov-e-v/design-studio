/*!
 * NAV-01: the jsdom URL mirrors a real dev-mode preview document — the proxy
 * origin serving bare app routes. The `data-upstream-origin` tests below point
 * at a DIFFERENT upstream (the actual dev server), so the two-origin link
 * allowlist (preview origin + upstream origin) is exercised for real.
 */
// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://127.0.0.1:9533/boards/current"}
import { describe, it, expect, vi } from "vitest";
import { PROTOCOL_VERSION } from "./protocol";

const trustedOrigin = "vscode-webview://webview-abc";
const ping = { type: "ds:ping", version: PROTOCOL_VERSION, nonce: "n-1", sessionId: "n-1" };

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

/**
 * Fresh module instance per runtime spawn (vi.resetModules): the re-init
 * guard (P0-2) would otherwise keep earlier closures from prior tests in
 * this shared jsdom window alive. The DOM (script tag attributes) must be
 * prepared BEFORE the import — module import auto-runs the init.
 */
/**
 * Listener registrations made by each spawned runtime instance. Removing them
 * before the next spawn keeps stale instances (which would otherwise re-
 * handshake on every ping and double-handle every message) out of later tests.
 */
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

async function spawnRuntime(scriptAttrs = ""): Promise<void> {
  // Let the previous instance disconnect its MutationObserver before spawn.
  window.dispatchEvent(new Event("pagehide"));
  removeRuntimeListeners();
  vi.resetModules();
  (window as unknown as { __dsRuntimeInitialized?: boolean }).__dsRuntimeInitialized = false;
  document.head.innerHTML = `<script data-design-studio="1" src="/__ds-runtime.js"${scriptAttrs}></script>`;
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

/**
 * P0-2: initDesignStudioRuntime must be idempotent. A re-injected runtime
 * script (double injection, HMR, future injection paths) must not create a
 * second runtime instance with duplicated message/click listeners, outlines
 * and history patches.
 */
describe("initDesignStudioRuntime re-entrancy guard", () => {
  it("second call does not add listeners or outlines", async () => {
    await spawnRuntime();
    const windowListenerSpy = vi.spyOn(window, "addEventListener");
    const documentListenerSpy = vi.spyOn(document, "addEventListener");
    const bodyChildren = document.body.childElementCount;

    const mod = await import("./index.js");
    mod.initDesignStudioRuntime();
    mod.initDesignStudioRuntime();

    // The spawn's listeners were registered before the spies were attached;
    // any additional full init would duplicate every window/document listener.
    expect(windowListenerSpy.mock.calls.length).toBe(0);
    expect(documentListenerSpy.mock.calls.length).toBe(0);
    expect(document.body.childElementCount).toBe(bodyChildren);

    windowListenerSpy.mockRestore();
    documentListenerSpy.mockRestore();
  });
});

/**
 * P0-3: browse-mode link policy. The runtime must engage the anchor policy
 * even without an explicit data-upstream-origin (fallback: <base>/location),
 * and block cross-origin as well as javascript:/data:/blob: links.
 */
describe("browse-mode link policy", () => {
  async function prepared(scriptAttrs: string): Promise<void> {
    await spawnRuntime(scriptAttrs);
    // Handshake first: without a trusted parent the runtime refuses to send.
    receive(ping, trustedOrigin);
  }

  function withClick(anchorId: string): { event: MouseEvent; messages: Array<{ msg: Record<string, unknown>; target: string }> } {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    const spy = vi.spyOn(window, "postMessage").mockImplementation((() => {}) as typeof window.postMessage);
    try {
      document.getElementById(anchorId)!.dispatchEvent(event);
      return {
        event,
        messages: (spy.mock.calls as unknown as Array<[msg: Record<string, unknown>, target: string]>).map(
          ([msg, target]) => ({ msg, target })
        ),
      };
    } finally {
      spy.mockRestore();
    }
  }

  it("blocks cross-origin links and posts ds:navigate-blocked (no attribute: fallback to location)", async () => {
    await prepared("");
    document.body.innerHTML = '<a id="ext" href="https://evil.example/page">ext</a>';
    const posted = withClick("ext");
    const blocked = posted.messages.find((p) => p.msg.type === "ds:navigate-blocked");
    expect(blocked).toBeDefined();
    expect((blocked as unknown as { msg: { url?: string } }).msg.url).toBe("https://evil.example/page");
  });

  it("blocks javascript: links via the explicit upstream-origin attribute", async () => {
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"');
    document.body.innerHTML = '<a id="js" href="javascript:alert(1)">js</a>';
    const posted = withClick("js");
    expect(posted.event.defaultPrevented).toBe(true);
    expect(posted.messages.some((p) => p.msg.type === "ds:navigate-blocked")).toBe(true);
  });

  it("NAV-02: leaves same-origin links on bare-path documents to native navigation (SPA-safe)", async () => {
    await prepared("");
    document.body.innerHTML = '<a id="same" href="/next/page">same</a>';
    const posted = withClick("same");
    // Bare-path documents (sticky dev routes) must NOT preventDefault: that
    // would break SPA client-side routing. NAV-02: no hijack, no block.
    expect(posted.event.defaultPrevented).toBe(false);
    expect(posted.messages.find((p) => p.msg.type === "ds:navigate-blocked")).toBeUndefined();
  });

  it("NAV-01: navigates preview-origin links when data-upstream-origin points at the dev server", async () => {
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"'); // upstream differs from the proxy origin
    document.body.innerHTML = '<a id="board" href="/boards/cmwgbjgec0002veccx0ufeoyh">board</a>';
    const posted = withClick("board");
    // NAV-02: on a bare-path document a preview-origin (same-origin) link is
    // passed to native/SPA navigation — never preventDefault, never blocked.
    // Before NAV-01 this click posted ds:navigate-blocked (inverted policy).
    expect(posted.event.defaultPrevented).toBe(false);
    expect(posted.messages.find((p) => p.msg.type === "ds:navigate-blocked")).toBeUndefined();
  });

  it("NAV-01: does not block absolute links to the upstream origin", async () => {
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"');
    document.body.innerHTML = '<a id="up" href="http://127.0.0.1:4600/x">up</a>';
    const posted = withClick("up");
    expect(posted.event.defaultPrevented).toBe(true);
    expect(posted.messages.find((p) => p.msg.type === "ds:navigate-blocked")).toBeUndefined();
  });

  it("NAV-01: blocks external origins even when the upstream attribute is set", async () => {
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"');
    document.body.innerHTML = '<a id="ext" href="https://example.com/">ext</a>';
    const posted = withClick("ext");
    expect(posted.event.defaultPrevented).toBe(true);
    expect(posted.messages.some((p) => p.msg.type === "ds:navigate-blocked")).toBe(true);
  });

  it("NAV-01: blocks target=_blank links on internal routes", async () => {
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"');
    document.body.innerHTML = '<a id="newtab" href="/boards/next" target="_blank">newtab</a>';
    const posted = withClick("newtab");
    expect(posted.event.defaultPrevented).toBe(true);
    expect(posted.messages.some((p) => p.msg.type === "ds:navigate-blocked")).toBe(true);
  });

  it("NAV-02: hijacks upstream-origin links on bare-path documents into location.assign", async () => {
    // jsdom document lives on the proxy origin (bare path); the upstream link
    // is absolute — it must be hijacked so the frame stays on the preview host.
    await prepared(' data-upstream-origin="http://127.0.0.1:4600"');
    document.body.innerHTML = '<a id="up" href="http://127.0.0.1:4600/x">up</a>';
    const posted = withClick("up");
    expect(posted.event.defaultPrevented).toBe(true);
    expect(posted.messages.find((p) => p.msg.type === "ds:navigate-blocked")).toBeUndefined();
  });
});

/**
 * P1-1: the runtime must only accept handshake/control messages from trusted
 * parent origins (VS Code webview allowlist + injected list + same-origin
 * embedding) and answer strictly to the ping's origin — never to "*".
 */
describe("parent origin policy", () => {
  it("does not activate the session for an untrusted parent origin", async () => {
    await spawnRuntime();
    const posted = withPostSpy(() => receive(ping, "https://evil.example"));
    expect(posted.find((p) => p.msg.type === "ds:pong")).toBeUndefined();
  });

  it("activates only for trusted origins and replies to the ping origin, never '*'", async () => {
    await spawnRuntime();
    const posted = withPostSpy(() => receive(ping, trustedOrigin));
    const pong = posted.find((p) => p.msg.type === "ds:pong");
    expect(pong).toBeDefined();
    expect(pong!.target).toBe(trustedOrigin);
    expect(posted.every((p) => p.target !== "*")).toBe(true);
  });

  it("ignores a 'null' (sandboxed) embedder origin", async () => {
    await spawnRuntime();
    const posted = withPostSpy(() => receive(ping, "null"));
    expect(posted.find((p) => p.msg.type === "ds:pong")).toBeUndefined();
  });

  it("trusting an injected data-parent-origins entry activates the session", async () => {
    await spawnRuntime(' data-parent-origins="https://host.example"');
    const posted = withPostSpy(() => receive(ping, "https://host.example"));
    expect(posted.find((p) => p.msg.type === "ds:pong")).toBeDefined();
  });
});

/**
 * P2-13: runtime-ready / runtime-error now have producers. Announcements
 * carry no page data and never go out to "*".
 */
describe("runtime announcements", () => {
  it("posts ds:runtime-ready with the protocol version to a concrete origin", async () => {
    const { postRuntimeAnnouncement } = await import("./index.js");
    const posted = withPostSpy(() => postRuntimeAnnouncement("ready", undefined, { targetOrigin: trustedOrigin }));
    expect(posted).toHaveLength(1);
    expect(posted[0].msg.type).toBe("ds:runtime-ready");
    expect(posted[0].msg.version).toBe(PROTOCOL_VERSION);
    expect(posted[0].target).toBe(trustedOrigin);
  });

  it("posts ds:runtime-error with a truncated message", async () => {
    const { postRuntimeAnnouncement } = await import("./index.js");
    const long = "x".repeat(800);
    const posted = withPostSpy(() => postRuntimeAnnouncement("error", long, { targetOrigin: trustedOrigin }));
    expect(posted).toHaveLength(1);
    expect(posted[0].msg.type).toBe("ds:runtime-error");
    expect(String(posted[0].msg.message).length).toBe(500);
  });

  it("never announces without a known parent origin and never to '*'", async () => {
    const { postRuntimeAnnouncement } = await import("./index.js");
    const posted = withPostSpy(() => {
      postRuntimeAnnouncement("ready", undefined, { targetOrigin: null });
      postRuntimeAnnouncement("ready", undefined, { targetOrigin: "*" });
    });
    expect(posted).toHaveLength(0);
  });
});

/**
 * P2-3: CSS rules nested in @media/@supports/@layer/@container (Tailwind v4
 * emits only those) must be visible to selection payloads and "Сохранить стили".
 */
describe("collectSourceRulesFromStylesheets (P2-3)", () => {
  it("finds matching style rules nested in grouping rules", async () => {
    const { collectSourceRulesFromStylesheets } = await import("./index.js");
    const el = document.createElement("div");
    el.className = "btn";
    document.body.appendChild(el);
    const rules = [
      {
        cssRules: [
          { selectorText: ".btn", cssText: ".btn { color: red; }" },
          { selectorText: ".other", cssText: ".other { color: blue; }" },
        ],
      },
      { selectorText: ".btn", cssText: ".btn { margin: 0; }" },
    ];
    const found = collectSourceRulesFromStylesheets(
      [{ href: "http://app/app.css", cssRules: rules as unknown as CSSRuleList }],
      el as Element
    );
    expect(found?.map((r) => r.selectorText)).toEqual([".btn", ".btn"]);
    expect(found?.[0].href).toBe("http://app/app.css");
  });

  it("respects the shared scan budget", async () => {
    const { collectSourceRulesFromStylesheets } = await import("./index.js");
    const el = document.createElement("div");
    el.className = "btn";
    document.body.appendChild(el);
    const filler = Array.from({ length: 2000 }, () => ({ selectorText: ".noise", cssText: ".noise {}" }));
    const found = collectSourceRulesFromStylesheets(
      [{ href: "http://app/big.css", cssRules: filler as unknown as CSSRuleList }],
      el
    );
    // No matching rule within the budget — no rules at all.
    expect(found).toBeUndefined();
  });
});

/** P2-12: React 16 mounts fragments at __reactInternalInstance$ keys. */
describe("findFiber React 16 keys (P2-12)", () => {
  it("matches __reactInternalInstance$ prefix", async () => {
    const { findFiber } = await import("./index.js");
    const el = document.createElement("div");
    const fiber = { tag: 5 };
    const holder = el as unknown as Record<string, unknown>;
    holder["__reactInternalInstance$abc123"] = fiber;
    expect(findFiber(el)).toBe(fiber);
  });
});

/**
 * P2-17: getSelector walks to the body, so deep nodes that share their six
 * nearest ancestors still get distinct selectors.
 */
describe("getSelector uniqueness (P2-17)", () => {
  it("is unique for a deep chain whose distinguishing ancestor is beyond 6 levels", async () => {
    const { getSelector } = await import("./index.js");
    const chain = (): string => Array.from({ length: 9 }, () => "<div>").join("") + "<span class=leaf>x</span>" + Array.from({ length: 9 }, () => "</div>").join("");
    document.body.innerHTML = '<div><div class=chainA>' + chain() + '</div><div class=chainB>' + chain() + '</div></div>';
    const leafB = document.querySelector(".chainB .leaf") as Element;
    const selector = getSelector(leafB);
    expect(document.querySelectorAll(selector).length).toBe(1);
  });
});

/** P2-17: duplicating an element must keep descendant ids unique but intact. */
describe("duplicate op (P2-17)", () => {
  it("suffixes clone ids and remaps in-clone references", async () => {
    document.body.innerHTML = '<div id="target"><label for="para">L</label><p id="para" aria-describedby="para">x</p><a href="#para">j</a><a href="#outside">o</a></div>';
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    const target = document.getElementById("target") as Element;
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "duplicate", requestId: "r-1", sessionId: "n-1" }, trustedOrigin);
    expect(document.querySelectorAll("#target").length).toBe(1);
    expect(document.querySelectorAll("#para").length).toBe(1);
    const clone = document.querySelector("[data-ds-clone]") as Element;
    expect(clone.id).toMatch(/^target-/);
    const clonePara = clone.querySelector("p") as Element;
    expect(clonePara.id).toMatch(/^para-/);
    expect(clone.querySelector("label")!.getAttribute("for")).toBe(clonePara.id);
    expect(clonePara.getAttribute("aria-describedby")).toBe(clonePara.id);
    expect(clone.querySelector("a")!.getAttribute("href")).toBe(`#${clonePara.id}`);
    // References outside the clone stay untouched.
    expect(clone.querySelectorAll("a")[1].getAttribute("href")).toBe("#outside");
  });
});
/** P2-6: popup must follow scroll/resize — runtime reposts a fresh rect. */
describe("selection rect updates (P2-6)", () => {
  it("posts ds:rect with a fresh rect on scroll while an element is selected", async () => {
    await spawnRuntime();
    document.body.innerHTML = '<div id="tip">x</div>';
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    const target = document.getElementById("tip") as Element;
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    // The repost happens on the rAF callback; jsdom schedules it on a ~16 ms
    // timer, so wait for a real tick and observe postMessage in that window.
    const posted: Array<{ msg: Record<string, unknown>; target: string }> = [];
    const spy = vi
      .spyOn(window, "postMessage")
      .mockImplementation(((msg: unknown, target: string) => {
        posted.push({ msg: msg as Record<string, unknown>, target });
      }) as typeof window.postMessage);
    try {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const rectMsg = posted.find((m) => m.msg.type === "ds:rect");
      expect(rectMsg).toBeDefined();
      expect(rectMsg!.target).toBe(trustedOrigin);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * P3-6 coverage: the session control-message paths — set-mode, apply-style,
 * apply-op (all element ops) and history/reload navigation — exercised against
 * the same jsdom runtime spawn used by the policy tests above. Every test
 * handshakes with its OWN sessionId: earlier runtime instances from previous
 * spawns are still subscribed to the shared jsdom window, but they drop
 * messages that carry a foreign session id (only the freshest runtime
 * answers), which keeps assertions deterministic.
 */
describe("session control messages", () => {
  let sessionCounter = 0;

  async function spawnAndHandshake(): Promise<string> {
    await spawnRuntime();
    const session = `sess-${++sessionCounter}`;
    receivesWithPost({ type: "ds:ping", version: PROTOCOL_VERSION, nonce: session, sessionId: session });
    return session;
  }

  function receivesWithPost(data: unknown): Array<{ msg: Record<string, unknown>; target: string }> {
    return withPostSpy(() => receive(data, trustedOrigin));
  }

  function message(session: string, extra: Record<string, unknown>): Record<string, unknown> {
    return { version: PROTOCOL_VERSION, sessionId: session, ...extra };
  }

  function dispatchPointerDown(el: Element): void {
    const down = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "target", { value: el });
    withPostSpy(() => document.dispatchEvent(down));
  }

  function opApplied(posted: Array<{ msg: Record<string, unknown>; target: string }>): Record<string, unknown> {
    const applied = posted.find((p) => p.msg.type === "ds:op-applied");
    expect(applied).toBeDefined();
    return applied!.msg;
  }

  async function sessionWithSelected(id: string): Promise<string> {
    const session = await spawnAndHandshake();
    await receivesWithPost({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: session });
    document.body.innerHTML = `<div id="${id}">orig</div>`;
    dispatchPointerDown(document.getElementById(id)!);
    return session;
  }

  it("set-mode toggles edit mode and replies with ds:mode-changed", async () => {
    const session = await spawnAndHandshake();
    const posted = receivesWithPost(message(session, { type: "ds:set-mode", enabled: true }));
    const changed = posted.find((p) => p.msg.type === "ds:mode-changed");
    expect(changed).toBeDefined();
    expect(changed!.msg.enabled).toBe(true);
    const off = receivesWithPost(message(session, { type: "ds:set-mode", enabled: false }));
    expect(off.find((p) => p.msg.type === "ds:mode-changed")!.msg.enabled).toBe(false);
  });

  it("ignores control messages with a foreign session id, wrong version or an unvalidated type", async () => {
    const session = await spawnAndHandshake();
    const foreign = receivesWithPost({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "intruder" });
    expect(foreign.some((p) => p.msg.type === "ds:mode-changed")).toBe(false);
    const wrongVersion = receivesWithPost({ type: "ds:set-mode", version: "1", enabled: true, sessionId: session });
    expect(wrongVersion.some((p) => p.msg.type === "ds:mode-changed")).toBe(false);
    const unvalidated = receivesWithPost({ type: "ds:mode-changed", version: PROTOCOL_VERSION, enabled: true, sessionId: session });
    expect(unvalidated.some((p) => p.msg.type === "ds:mode-changed")).toBe(false);
  });

  it("apply-style: missing selection failure and applied success path", async () => {
    const session = await spawnAndHandshake();
    const none = receivesWithPost(message(session, { type: "ds:apply-style", property: "color", value: "red", requestId: "r2" }));
    expect(none[0].msg).toMatchObject({ type: "ds:style-applied", success: false, reason: "No selected element", requestId: "r2" });

    await receivesWithPost(message(session, { type: "ds:set-mode", enabled: true }));
    document.body.innerHTML = '<div id="styled">x</div>';
    dispatchPointerDown(document.getElementById("styled")!);
    const ok = receivesWithPost(message(session, { type: "ds:apply-style", property: "color", value: "blue", requestId: "r3" }));
    const applied = ok.filter((p) => p.msg.type === "ds:style-applied").at(-1);
    expect(applied).toBeDefined();
    expect(applied!.msg.success).toBe(true);
    expect(applied!.msg.requestId).toBe("r3");
    expect(document.getElementById("styled")!.getAttribute("style")).toContain("color");
  });

  it("apply-op: set-text on a div, on a text input, and a password refusal", async () => {
    let posted: Array<{ msg: Record<string, unknown>; target: string }>;

    const sessionA = await sessionWithSelected("target");
    posted = receivesWithPost(message(sessionA, { type: "ds:apply-op", op: "set-text", value: "Hello", requestId: "r1" }));
    expect(opApplied(posted)).toMatchObject({ op: "set-text", success: true, requestId: "r1", value: "Hello" });
    expect(document.getElementById("target")!.textContent).toBe("Hello");

    const sessionB = await spawnAndHandshake();
    await receivesWithPost(message(sessionB, { type: "ds:set-mode", enabled: true }));
    document.body.innerHTML = '<input id="field" type="text">';
    const input = document.getElementById("field") as HTMLInputElement;
    dispatchPointerDown(input);
    posted = receivesWithPost(message(sessionB, { type: "ds:apply-op", op: "set-text", value: "Typed", requestId: "r2" }));
    expect(opApplied(posted).success).toBe(true);
    expect(input.value).toBe("Typed");
    expect(input.getAttribute("value")).toBe("Typed");

    const sessionC = await spawnAndHandshake();
    await receivesWithPost(message(sessionC, { type: "ds:set-mode", enabled: true }));
    document.body.innerHTML = '<input id="secret" type="password">';
    const password = document.getElementById("secret") as HTMLInputElement;
    dispatchPointerDown(password);
    posted = receivesWithPost(message(sessionC, { type: "ds:apply-op", op: "set-text", value: "evil", requestId: "r3" }));
    expect(opApplied(posted)).toMatchObject({ op: "set-text", success: false, reason: "Password values cannot be edited", requestId: "r3" });
    expect(password.value).toBe("");
  });

  it("apply-op: delete selects the parent, move fails without siblings, duplicate and set-classes work", async () => {
    let posted: Array<{ msg: Record<string, unknown>; target: string }>;
    const session = await spawnAndHandshake();
    await receivesWithPost(message(session, { type: "ds:set-mode", enabled: true }));

    document.body.innerHTML = '<div id="wrap"><span id="inner">x</span></div>';
    dispatchPointerDown(document.getElementById("inner")!);
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "delete", requestId: "r1" }));
    expect(opApplied(posted).success).toBe(true);
    expect(document.getElementById("wrap")).not.toBeNull();
    expect(document.getElementById("inner")).toBeNull();

    dispatchPointerDown(document.getElementById("wrap")!);
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "move-up", requestId: "r2" }));
    expect(opApplied(posted)).toMatchObject({ op: "move-up", success: false, reason: "No previous sibling", requestId: "r2" });
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "move-down", requestId: "r3" }));
    expect(opApplied(posted)).toMatchObject({ op: "move-down", success: false, reason: "No next sibling" });

    document.body.innerHTML = '<ul id="list"><li id="item">a</li></ul>';
    dispatchPointerDown(document.getElementById("item")!);
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "duplicate", requestId: "r4" }));
    expect(opApplied(posted).success).toBe(true);
    expect(document.querySelectorAll("#list li")).toHaveLength(2);

    dispatchPointerDown(document.getElementById("item")!);
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "set-classes", value: "a b", requestId: "r5" }));
    expect(opApplied(posted).success).toBe(true);
    expect(document.getElementById("item")!.getAttribute("class")).toBe("a b");
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "set-classes", value: 'bad "quote"', requestId: "r6" }));
    expect(opApplied(posted)).toMatchObject({ op: "set-classes", success: false, reason: "Invalid class list", requestId: "r6" });
  });

  it("apply-op: set-attribute mirrors the live value property, blocks javascript: URLs and removes on empty", async () => {
    let posted: Array<{ msg: Record<string, unknown>; target: string }>;
    const session = await spawnAndHandshake();
    await receivesWithPost(message(session, { type: "ds:set-mode", enabled: true }));

    document.body.innerHTML = '<a id="link" href="/safe">x</a>';
    dispatchPointerDown(document.getElementById("link")!);
    posted = receivesWithPost(
      message(session, { type: "ds:apply-op", op: "set-attribute", attribute: "href", value: "javascript:alert(1)", requestId: "r1" })
    );
    expect(opApplied(posted)).toMatchObject({ op: "set-attribute", success: false, reason: "Blocked URL scheme", requestId: "r1", attribute: "href" });
    expect(document.getElementById("link")!.getAttribute("href")).toBe("/safe");

    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "set-attribute", attribute: "href", value: "/target", requestId: "r2" }));
    expect(opApplied(posted).success).toBe(true);
    expect(document.getElementById("link")!.getAttribute("href")).toBe("/target");

    document.body.innerHTML = '<input id="box" value="keep">';
    dispatchPointerDown(document.getElementById("box")!);
    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "set-attribute", attribute: "value", value: "live", requestId: "r3" }));
    expect(opApplied(posted).success).toBe(true);
    expect((document.getElementById("box") as HTMLInputElement).value).toBe("live");

    posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "set-attribute", attribute: "value", value: "", requestId: "r4" }));
    expect(opApplied(posted).success).toBe(true);
    expect(document.getElementById("box")!.hasAttribute("value")).toBe(false);
  });

  it("apply-op without a selection fails with 'No selected element'", async () => {
    const session = await spawnAndHandshake();
    const posted = receivesWithPost(message(session, { type: "ds:apply-op", op: "set-text", value: "x", requestId: "r1" }));
    expect(opApplied(posted)).toMatchObject({ op: "set-text", success: false, reason: "No selected element", requestId: "r1" });
  });

  it("navigate-history dispatches per direction", async () => {
    const session = await spawnAndHandshake();
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const forwardSpy = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    try {
      receivesWithPost(message(session, { type: "ds:navigate-history", direction: "back" }));
      receivesWithPost(message(session, { type: "ds:navigate-history", direction: "forward" }));
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(forwardSpy).toHaveBeenCalledTimes(1);
    } finally {
      backSpy.mockRestore();
      forwardSpy.mockRestore();
    }
  });
});

/** Edit-mode UX: large arrow cursor, non-destructive own-text edits, edit badges. */
describe("edit-mode UX (cursor, own text, marks)", () => {
  it("set-text preserves child elements and only replaces own text", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    document.body.innerHTML = '<div id="card">Own <b id="keep">child</b> tail</div>';
    const card = document.getElementById("card")!;
    card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-text", value: "Changed", requestId: "t1", sessionId: "n-1" }, trustedOrigin);
    expect(document.getElementById("keep")).not.toBeNull();
    expect(card.textContent).toBe("Changedchild");
    // The trailing own text node is removed, not blanked.
    expect(card.childNodes.length).toBe(2);
  });

  it("set-text keeps text after a child element in place (whitespace separators survive)", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    document.body.innerHTML = '<div id="card"> <b id="keep">child</b> tail</div>';
    const card = document.getElementById("card")!;
    card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-text", value: "Changed", requestId: "t2", sessionId: "n-1" }, trustedOrigin);
    // The new text lands in the node AFTER <b>, never jumps before it.
    expect(card.textContent).toBe(" childChanged");
    expect(card.lastChild!.nodeType).toBe(3);
    expect(card.lastChild!.nodeValue).toBe("Changed");
  });

  it("set-text with an empty value removes all non-whitespace own text nodes", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    document.body.innerHTML = '<div id="card">Hello <b id="keep">x</b> bye</div>';
    const card = document.getElementById("card")!;
    card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-text", value: "", requestId: "t3", sessionId: "n-1" }, trustedOrigin);
    expect(card.textContent).toBe("x");
    expect(document.getElementById("keep")).not.toBeNull();
  });

  it("set-text on an element without own text nodes inserts text, empty value is a no-op", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    document.body.innerHTML = '<div id="card"><b id="keep">x</b></div>';
    const card = document.getElementById("card")!;
    card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-text", value: "", requestId: "t4", sessionId: "n-1" }, trustedOrigin);
    expect(card.textContent).toBe("x");
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-text", value: "New", requestId: "t5", sessionId: "n-1" }, trustedOrigin);
    expect(card.textContent).toBe("Newx");
  });

  it("edit mode sets the large-arrow cursor attribute and clears it on browse", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    expect(document.documentElement.hasAttribute("data-ds-edit-mode")).toBe(true);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: false, sessionId: "n-1" }, trustedOrigin);
    expect(document.documentElement.hasAttribute("data-ds-edit-mode")).toBe(false);
  });

  it("ds:mark adds a badge overlay for the marked selector", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    document.body.innerHTML = '<div id="marked">x</div>';
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "#marked", marked: true, sessionId: "n-1" }, trustedOrigin);
    // hover outline + selection outline + one edit badge
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBeGreaterThanOrEqual(3);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "#marked", marked: false, sessionId: "n-1" }, trustedOrigin);
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBe(2);
  });

  it("ds:mark refuses non-selectable targets (head, script, body)", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    document.body.innerHTML = '<div id="ok">x</div><script id="bad">void 0;</script>';
    const before = document.querySelectorAll("body > div[data-design-studio]").length;
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "head", marked: true, sessionId: "n-1" }, trustedOrigin);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "#bad", marked: true, sessionId: "n-1" }, trustedOrigin);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "body", marked: true, sessionId: "n-1" }, trustedOrigin);
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBe(before);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "#ok", marked: true, sessionId: "n-1" }, trustedOrigin);
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBe(before + 1);
  });
});

/** Shared helpers for the message-driven suites below. */
let undoSessionCounter = 0;
async function spawnSelected(html: string, selectId: string): Promise<string> {
  await spawnRuntime();
  const session = `sess-x${++undoSessionCounter}`;
  receive({ type: "ds:ping", version: PROTOCOL_VERSION, nonce: session, sessionId: session }, trustedOrigin);
  receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: session }, trustedOrigin);
  document.body.innerHTML = html;
  const down = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(down, "target", { value: document.getElementById(selectId) });
  withPostSpy(() => document.dispatchEvent(down));
  return session;
}
function send(session: string, extra: Record<string, unknown>): Array<{ msg: Record<string, unknown>; target: string }> {
  return withPostSpy(() => receive({ version: PROTOCOL_VERSION, sessionId: session, ...extra }, trustedOrigin));
}

/** ds:undo restores delete/duplicate/move snapshots taken per requestId. */
describe("structure op undo (ds:undo)", () => {
  const undone = (posted: Array<{ msg: Record<string, unknown>; target: string }>): Record<string, unknown> => {
    const msg = posted.find((p) => p.msg.type === "ds:undone");
    expect(msg).toBeDefined();
    return msg!.msg;
  };

  it("restores a deleted element at its original index", async () => {
    const session = await spawnSelected('<div id="wrap"><span id="a">a</span><span id="del">x</span><span id="b">b</span></div>', "del");
    send(session, { type: "ds:apply-op", op: "delete", requestId: "u1" });
    expect(document.getElementById("del")).toBeNull();
    const posted = send(session, { type: "ds:undo", requestId: "u1" });
    expect(undone(posted)).toMatchObject({ success: true, requestId: "u1" });
    expect(undone(posted).payload).not.toBeNull();
    const wrap = document.getElementById("wrap")!;
    expect(wrap.children[1].id).toBe("del");
    // The snapshot is consumed: a second undo of the same id fails.
    expect(undone(send(session, { type: "ds:undo", requestId: "u1" }))).toMatchObject({ success: false, reason: "Unknown requestId" });
  });

  it("fails a delete undo when the parent is gone", async () => {
    const session = await spawnSelected('<div id="wrap"><span id="del">x</span></div>', "del");
    send(session, { type: "ds:apply-op", op: "delete", requestId: "u2" });
    document.getElementById("wrap")!.remove();
    expect(undone(send(session, { type: "ds:undo", requestId: "u2" }))).toMatchObject({ success: false, reason: "Parent not found" });
  });

  it("removes the clone on duplicate undo", async () => {
    const session = await spawnSelected('<div id="wrap"><p id="src">x</p></div>', "src");
    send(session, { type: "ds:apply-op", op: "duplicate", requestId: "u3" });
    expect(document.querySelectorAll("#wrap p")).toHaveLength(2);
    const posted = send(session, { type: "ds:undo", requestId: "u3" });
    expect(undone(posted)).toMatchObject({ success: true, requestId: "u3", payload: null });
    expect(document.querySelectorAll("#wrap p")).toHaveLength(1);
    expect(document.querySelector("[data-ds-clone]")).toBeNull();
  });

  it("returns a moved element to its original position", async () => {
    const session = await spawnSelected('<ul id="list"><li id="one">1</li><li id="two">2</li></ul>', "one");
    send(session, { type: "ds:apply-op", op: "move-down", requestId: "u4" });
    expect(Array.from(document.getElementById("list")!.children).map((c) => c.id)).toEqual(["two", "one"]);
    const posted = send(session, { type: "ds:undo", requestId: "u4" });
    expect(undone(posted)).toMatchObject({ success: true, requestId: "u4" });
    expect(Array.from(document.getElementById("list")!.children).map((c) => c.id)).toEqual(["one", "two"]);
  });

  it("rejects an unknown requestId", async () => {
    const session = await spawnSelected('<div id="solo">x</div>', "solo");
    expect(undone(send(session, { type: "ds:undo", requestId: "nope" }))).toMatchObject({ success: false, reason: "Unknown requestId" });
  });
});

/** URL-attribute sanitizing: control-char scheme obfuscation, data:text/html, form actions. */
describe("URL attribute sanitizing", () => {
  it("blocks java\\tscript:/java\\nscript:, javascript: action and data:text/html src; allows https and data:image", async () => {
    const session = await spawnSelected('<a id="link" href="/safe">x</a>', "link");
    for (const [i, value] of ["java\tscript:alert(1)", "java\nscript:alert(1)", "java\rscript:alert(1)"].entries()) {
      const posted = send(session, { type: "ds:apply-op", op: "set-attribute", attribute: "href", value, requestId: `b${i}` });
      expect(posted.find((p) => p.msg.type === "ds:op-applied")!.msg).toMatchObject({ success: false, reason: "Blocked URL scheme" });
      expect(document.getElementById("link")!.getAttribute("href")).toBe("/safe");
    }
    const ok = send(session, { type: "ds:apply-op", op: "set-attribute", attribute: "href", value: "https://example.com/x", requestId: "ok1" });
    expect(ok.find((p) => p.msg.type === "ds:op-applied")!.msg.success).toBe(true);

    const formSession = await spawnSelected('<form id="f"><input id="img" src="/a.png"></form>', "f");
    const action = send(formSession, { type: "ds:apply-op", op: "set-attribute", attribute: "action", value: "javascript:alert(1)", requestId: "a1" });
    expect(action.find((p) => p.msg.type === "ds:op-applied")!.msg).toMatchObject({ success: false, reason: "Blocked URL scheme", attribute: "action" });
    expect(document.getElementById("f")!.hasAttribute("action")).toBe(false);

    const imgSession = await spawnSelected('<img id="pic" src="/a.png">', "pic");
    const htmlData = send(imgSession, { type: "ds:apply-op", op: "set-attribute", attribute: "src", value: "data:text/html;base64,PHNjcmlwdD4=", requestId: "d1" });
    expect(htmlData.find((p) => p.msg.type === "ds:op-applied")!.msg).toMatchObject({ success: false, reason: "Blocked URL scheme" });
    const imageData = send(imgSession, { type: "ds:apply-op", op: "set-attribute", attribute: "src", value: "data:image/png;base64,AAAA", requestId: "d2" });
    expect(imageData.find((p) => p.msg.type === "ds:op-applied")!.msg.success).toBe(true);
  });

  it("blocks submits of forms with a dangerous action in edit mode", async () => {
    await spawnSelected('<form id="evil" action="java\tscript:alert(1)"></form><form id="safe" action="/submit"></form>', "evil");
    const evilEvent = new Event("submit", { bubbles: true, cancelable: true });
    const posted = withPostSpy(() => document.getElementById("evil")!.dispatchEvent(evilEvent));
    expect(evilEvent.defaultPrevented).toBe(true);
    expect(posted.some((p) => p.msg.type === "ds:navigate-blocked")).toBe(true);
    const safeEvent = new Event("submit", { bubbles: true, cancelable: true });
    const safePosted = withPostSpy(() => document.getElementById("safe")!.dispatchEvent(safeEvent));
    expect(safeEvent.defaultPrevented).toBe(false);
    expect(safePosted.some((p) => p.msg.type === "ds:navigate-blocked")).toBe(false);
  });
});

/** apply-style must report invalid CSS values honestly instead of a silent success. */
describe("apply-style value validation", () => {
  it("replies invalid-value without marking the element; custom properties always pass", async () => {
    const session = await spawnSelected('<div id="styled">x</div>', "styled");
    const css = (window as unknown as { CSS: Record<string, unknown> }).CSS;
    const original = css.supports;
    css.supports = (property: string, value: string) => !(property === "color" && value === "not-a-color");
    try {
      const bad = send(session, { type: "ds:apply-style", property: "color", value: "not-a-color", requestId: "s1" });
      expect(bad.filter((p) => p.msg.type === "ds:style-applied").at(-1)!.msg).toMatchObject({ success: false, reason: "invalid-value", requestId: "s1" });
      expect(document.getElementById("styled")!.hasAttribute("style")).toBe(false);
      // No edit badge was created (only the two outlines live in body).
      expect(document.querySelectorAll("body > div[data-design-studio]").length).toBe(2);
      const good = send(session, { type: "ds:apply-style", property: "color", value: "blue", requestId: "s2" });
      expect(good.filter((p) => p.msg.type === "ds:style-applied").at(-1)!.msg.success).toBe(true);
      css.supports = () => false;
      const custom = send(session, { type: "ds:apply-style", property: "--brand", value: "anything goes", requestId: "s3" });
      expect(custom.filter((p) => p.msg.type === "ds:style-applied").at(-1)!.msg.success).toBe(true);
    } finally {
      if (original === undefined) delete css.supports;
      else css.supports = original;
    }
  });
});

/** ds:ping must not establish a session across a version mismatch. */
describe("ds:ping version gate", () => {
  it("pongs a mismatched ping with the runtime version but keeps the old session", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin); // establishes session n-1
    const posted = withPostSpy(() => receive({ type: "ds:ping", version: "999", nonce: "n-2", sessionId: "n-2" }, trustedOrigin));
    const pong = posted.find((p) => p.msg.type === "ds:pong");
    expect(pong).toBeDefined();
    expect(pong!.msg.version).toBe(PROTOCOL_VERSION);
    const control = withPostSpy(() => receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-2" }, trustedOrigin));
    expect(control.some((p) => p.msg.type === "ds:mode-changed")).toBe(false);
  });

  it("rejects a ping with an oversized sessionId", async () => {
    await spawnRuntime();
    const posted = withPostSpy(() => receive({ type: "ds:ping", version: PROTOCOL_VERSION, nonce: "n-3", sessionId: "s".repeat(129) }, trustedOrigin));
    expect(posted.find((p) => p.msg.type === "ds:pong")).toBeUndefined();
  });
});

/** DOM mutations (framework re-renders) must prune detached marks and reposition badges. */
describe("mutation-driven badge maintenance", () => {
  it("removes the badge of a detached marked element in edit mode", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    document.body.innerHTML = '<div id="m">x</div>';
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "#m", marked: true, sessionId: "n-1" }, trustedOrigin);
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBeGreaterThanOrEqual(3);
    document.getElementById("m")!.remove();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBe(2);
  });

  it("prunes detached marks even outside edit mode", async () => {
    await spawnRuntime();
    receive(ping, trustedOrigin);
    document.body.innerHTML = '<div id="m">x</div>';
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    receive({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "#m", marked: true, sessionId: "n-1" }, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: false, sessionId: "n-1" }, trustedOrigin);
    document.getElementById("m")!.remove();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.querySelectorAll("body > div[data-design-studio]").length).toBe(2);
  });
});
