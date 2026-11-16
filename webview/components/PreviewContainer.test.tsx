// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { PreviewContainer } from "./PreviewContainer";

/**
 * P1-1: webview -> iframe traffic must carry an explicit targetOrigin derived
 * from the preview URL instead of "*", and replies from the iframe are
 * accepted only from the preview origin.
 */
describe("PreviewContainer origin policy", () => {
  const baseProps = {
    status: "project",
    language: "ru" as const,
    editMode: false,
    onEditModeChange: () => {},
    onRefresh: () => {},
    onNavigate: () => {},
    onLocationChange: () => {},
    onSelect: () => {},
  };

  it("sends ds:ping with an explicit targetOrigin", () => {
    const { container } = render(
      React.createElement(PreviewContainer, { url: "http://127.0.0.1:4100/project/index.html", ...baseProps })
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.contentWindow).toBeTruthy();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    fireEvent(iframe, new Event("load"));

    const pingCall = postSpy.mock.calls.find((call) => (call[0] as { type?: string }).type === "ds:ping");
    expect(pingCall).toBeDefined();
    expect(pingCall![1]).toBe("http://127.0.0.1:4100");
  });

  // P2-13: the runtime announces itself (ds:runtime-ready, no nonce) right
  // after init; the container must resolve the handshake without waiting for
  // a ping round-trip and immediately push the current edit mode.
  it("resolves the handshake on a nonce-less ds:runtime-ready", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    const { container } = render(
      React.createElement(PreviewContainer, { url: "http://127.0.0.1:4100/project/index.html", ...baseProps })
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    fireEvent(iframe, new Event("load"));
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    fireEvent(window, new MessageEvent("message", {
      data: { type: "ds:runtime-ready", version: PROTOCOL_VERSION },
      origin: "http://127.0.0.1:4100",
      source: iframe.contentWindow,
    }));

    const setMode = postSpy.mock.calls.find((call) => (call[0] as { type?: string }).type === "ds:set-mode");
    expect(setMode).toBeDefined();
    expect((setMode![0] as { enabled?: boolean }).enabled).toBe(false);
    expect(typeof (setMode![0] as { sessionId?: string }).sessionId).toBe("string");
  });
});

/**
 * WV-02: the ds:navigate address must be built from the CURRENT dev server,
 * not the one captured when the message-handler effect (deps [url]) was
 * created. Also regression-guards the duplicated sessionId check that this
 * fix removed.
 */
describe("PreviewContainer address freshness (WV-02)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the latest devServer even when the url is unchanged", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-session-id");
    const props = {
      status: "devserver",
      language: "ru" as const,
      editMode: false,
      onEditModeChange: () => {},
      onRefresh: () => {},
      onNavigate: () => {},
      onLocationChange: () => {},
      onSelect: () => {},
    };
    const { container, rerender } = render(
      React.createElement(PreviewContainer, { url: "http://127.0.0.1:4100/boards/a", ...props })
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    fireEvent(iframe, new Event("load"));

    rerender(
      React.createElement(PreviewContainer, {
        url: "http://127.0.0.1:4100/boards/a",
        ...props,
        devServer: "http://localhost:4700",
      })
    );

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:navigate", version: PROTOCOL_VERSION, path: "/boards/b", sessionId: "fixed-session-id" },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });

    const addressInput = container.querySelector("input[aria-label]") as HTMLInputElement;
    expect(addressInput?.value).toBe("http://localhost:4700/boards/b");
  });
});
