// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@design-studio/preview-runtime/protocol";
import type { ElementPayload } from "./types";

/**
 * WV-01: the session edit journal (selection, pending styles, edits) must be
 * cleared when the iframe reports a REAL route change via ds:navigate, and
 * preserved when the path is unchanged (ds:navigate also fires on set-mode
 * with the same path). The journal lives in App, so the test drives the full
 * webview message flow with a pinned randomUUID (the PreviewContainer session
 * id) and an acquireVsCodeApi stub wired before the dynamic App import.
 */
describe("App session edit journal across navigation (WV-01)", () => {
  const SESSION = "fixed-session-id";
  const PREVIEW_URL = "http://127.0.0.1:4100/boards/a";
  let posted: unknown[];

  function elementPayload(selector: string): ElementPayload {
    return {
      selector,
      tag: "div",
      rect: { top: 0, left: 0, width: 100, height: 50 },
      styles: {},
    };
  }

  beforeEach(() => {
    posted = [];
    vi.spyOn(crypto, "randomUUID").mockReturnValue(SESSION as `${string}-${string}-${string}-${string}-${string}`);
    (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: (msg: unknown) => posted.push(msg),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
  });

  async function renderApp(): Promise<{ container: HTMLElement }> {
    const { App } = await import("./App");
    return render(React.createElement(App));
  }

  function dispatchExtensionData(data: unknown): void {
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data }));
    });
  }

  function dispatchRuntimeData(container: HTMLElement, data: unknown): void {
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data,
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow as MessageEventSource,
      }));
    });
  }

  function selectedSelector(container: HTMLElement): string | null {
    return container.querySelector("code")?.textContent ?? null;
  }

  it("clears selection and pending styles on a real route change, keeps them on the same path", async () => {
    const { container } = await renderApp();

    dispatchExtensionData({ type: "preview:state", url: PREVIEW_URL, status: "project", language: "ru" });

    dispatchRuntimeData(container, {
      type: "ds:select",
      version: PROTOCOL_VERSION,
      sessionId: SESSION,
      payload: elementPayload("div#hero"),
    });
    expect(selectedSelector(container)).toBe("div#hero");
    expect(posted.some((msg) => (msg as { type?: string }).type === "project:rememberNavigation")).toBe(false);

    // Same path twice (as set-mode re-sends do): the journal is preserved.
    dispatchRuntimeData(container, { type: "ds:navigate", version: PROTOCOL_VERSION, path: "/boards/a", sessionId: SESSION });
    expect(selectedSelector(container)).toBe("div#hero");

    // A real route change: the journal is reset.
    dispatchRuntimeData(container, { type: "ds:navigate", version: PROTOCOL_VERSION, path: "/boards/b", sessionId: SESSION });
    expect(selectedSelector(container)).toBeNull();

    // Both routes were reported to the extension for persistence.
    const paths = posted
      .filter((msg) => (msg as { type?: string }).type === "project:rememberNavigation")
      .map((msg) => (msg as { path?: string }).path);
    expect(paths).toEqual(["/boards/a", "/boards/b"]);
  });
});
