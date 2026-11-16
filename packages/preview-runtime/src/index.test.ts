// @vitest-environment jsdom
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
async function spawnRuntime(scriptAttrs = ""): Promise<void> {
  vi.resetModules();
  (window as unknown as { __dsRuntimeInitialized?: boolean }).__dsRuntimeInitialized = false;
  document.head.innerHTML = `<script data-design-studio="1" src="/__ds-runtime.js"${scriptAttrs}></script>`;
  const mod = await import("./index.js");
  mod.initDesignStudioRuntime();
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

  it("leaves same-origin links to ordinary navigation", async () => {
    await prepared("");
    document.body.innerHTML = '<a id="same" href="/next/page">same</a>';
    const posted = withClick("same");
    // Same-origin links are hijacked into a known-route navigation, not blocked.
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

/** P2-17: duplicating an element must not duplicate the ids of its descendants. */
describe("duplicate op (P2-17)", () => {
  it("strips ids from the clone and its descendants", async () => {
    document.body.innerHTML = '<div id="target"><section><p id="para">x</p></section></div>';
    await spawnRuntime();
    receive(ping, trustedOrigin);
    receive({ type: "ds:set-mode", version: PROTOCOL_VERSION, enabled: true, sessionId: "n-1" }, trustedOrigin);
    const target = document.getElementById("target") as Element;
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    receive({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "duplicate", requestId: "r-1", sessionId: "n-1" }, trustedOrigin);
    expect(document.querySelectorAll("#target").length).toBe(1);
    expect(document.querySelectorAll("#para").length).toBe(1);
    expect(document.querySelectorAll("[data-ds-clone] [id]").length).toBe(0);
  });
});
