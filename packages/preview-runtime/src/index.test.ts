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
