// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { PreviewContainer } from "./PreviewContainer";

// FIX-02 / FIX-03: first-page edit-mode handshake regressions (WV-03 root causes).
describe("PreviewContainer first-page handshake (FIX-02/FIX-03)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const baseProps = {
    url: "http://127.0.0.1:4100/project/index.html",
    editMode: false,
    language: "ru" as const,
    status: "project",
    onEditModeChange: () => {},
    onRefresh: () => {},
    onNavigate: () => {},
    onLocationChange: () => {},
    onSelect: () => {},
  };

  const announce = (iframe: HTMLIFrameElement, version: string) => {
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:runtime-ready", version },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });
  };

  it("FIX-02: pings the runtime on the nonce-less runtime-ready announcement", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-session-id" as `${string}-${string}-${string}-${string}-${string}`);
    const { container } = render(React.createElement(PreviewContainer, baseProps));
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");
    // No load event: the announcement alone must establish the session.
    announce(iframe, PROTOCOL_VERSION);
    const ping = postSpy.mock.calls.find((c) => (c[0] as { type?: string }).type === "ds:ping");
    expect(ping).toBeDefined();
    expect(ping![1]).toBe("http://127.0.0.1:4100");
  });

  it("FIX-03: resets the resync budget on a new handshake so set-mode keeps retrying", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.useFakeTimers();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-session-id" as `${string}-${string}-${string}-${string}-${string}`);
    const { container } = render(React.createElement(PreviewContainer, baseProps));
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");
    const count = () => postSpy.mock.calls.filter((c) => (c[0] as { type?: string }).type === "ds:set-mode").length;
    fireEvent(iframe, new Event("load"));
    announce(iframe, PROTOCOL_VERSION);
    // Exhaust the bounded resync without any echo.
    act(() => { vi.advanceTimersByTime(4000); });
    const exhausted = count();
    // A fresh announcement must restart the budget (clearTimers resets it).
    announce(iframe, PROTOCOL_VERSION);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(count()).toBeGreaterThan(exhausted + 1);
  });
});
