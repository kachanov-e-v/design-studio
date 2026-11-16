// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { initDesignStudioRuntime } from "./index.js";

/**
 * P0-2: initDesignStudioRuntime must be idempotent. A re-injected runtime
 * script (double injection, HMR, future injection paths) must not create a
 * second runtime instance with duplicated message/click listeners, outlines
 * and history patches.
 */
describe("initDesignStudioRuntime re-entrancy guard", () => {
  it("second call does not add listeners or outlines", () => {
    document.head.innerHTML = '<script data-design-studio="1" src="/__ds-runtime.js"></script>';

    initDesignStudioRuntime();
    const windowListenerSpy = vi.spyOn(window, "addEventListener");
    const documentListenerSpy = vi.spyOn(document, "addEventListener");
    const bodyChildren = document.body.childElementCount;

    initDesignStudioRuntime();

    // First call's listeners were registered before the spies were attached;
    // a second full init would duplicate every window/document listener.
    expect(windowListenerSpy.mock.calls.length).toBe(0);
    expect(documentListenerSpy.mock.calls.length).toBe(0);
    expect(document.body.childElementCount).toBe(bodyChildren);

    windowListenerSpy.mockRestore();
    documentListenerSpy.mockRestore();
  });

  it("re-entrant init never registers a second message listener", () => {
    document.head.innerHTML = '<script data-design-studio="1" src="/__ds-runtime.js"></script>';

    initDesignStudioRuntime();
    const listenerSpy = vi.spyOn(window, "addEventListener");
    initDesignStudioRuntime();
    initDesignStudioRuntime();
    expect(listenerSpy.mock.calls.length).toBe(0);
    listenerSpy.mockRestore();
  });
});

/**
 * P0-3: browse-mode link policy. The runtime must engage the anchor policy
 * even without an explicit data-upstream-origin (fallback: <base>/location),
 * and block cross-origin as well as javascript:/data:/blob: links.
 */
describe("browse-mode link policy", () => {
  function spawnRuntime(scriptAttrs: string): void {
    document.head.innerHTML = `<script data-design-studio="1" src="/__ds-runtime.js"${scriptAttrs}></script>`;
    initDesignStudioRuntime();
  }

  function click(anchorId: string): MouseEvent {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById(anchorId)!.dispatchEvent(event);
    return event;
  }

  it("blocks cross-origin links and posts ds:navigate-blocked (no attribute: fallback to location)", () => {
    spawnRuntime("");
    document.body.innerHTML = '<a id="ext" href="https://evil.example/page">ext</a>';
    const posted: unknown[] = [];
    const spy = vi.spyOn(window, "postMessage").mockImplementation(((msg: unknown) => {
      posted.push(msg);
    }) as typeof window.postMessage);

    const event = click("ext");

    expect(event.defaultPrevented).toBe(true);
    const blocked = posted.find((m) => (m as { type?: string }).type === "ds:navigate-blocked");
    expect(blocked).toBeDefined();
    expect((blocked as { url?: string }).url).toBe("https://evil.example/page");
    spy.mockRestore();
  });

  it("blocks javascript: links via the explicit upstream-origin attribute", () => {
    spawnRuntime(' data-upstream-origin="http://127.0.0.1:4600"');
    document.body.innerHTML = '<a id="js" href="javascript:alert(1)">js</a>';
    const posted: unknown[] = [];
    const spy = vi.spyOn(window, "postMessage").mockImplementation(((msg: unknown) => {
      posted.push(msg);
    }) as typeof window.postMessage);

    const event = click("js");

    expect(event.defaultPrevented).toBe(true);
    expect(posted.some((m) => (m as { type?: string }).type === "ds:navigate-blocked")).toBe(true);
    spy.mockRestore();
  });

  it("leaves same-origin links to ordinary navigation", () => {
    spawnRuntime("");
    document.body.innerHTML = '<a id="same" href="/next/page">same</a>';
    const posted: unknown[] = [];
    const spy = vi.spyOn(window, "postMessage").mockImplementation(((msg: unknown) => {
      posted.push(msg);
    }) as typeof window.postMessage);

    const event = click("same");

    // Same-origin links are hijacked into a known-route navigation, not blocked.
    expect(event.defaultPrevented).toBe(true);
    expect(posted.find((m) => (m as { type?: string }).type === "ds:navigate-blocked")).toBeUndefined();
    spy.mockRestore();
  });
});
