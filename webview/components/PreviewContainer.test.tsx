// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
});
