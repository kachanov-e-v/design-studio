// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listeners: new Set<(msg: unknown) => void>(),
}));

vi.mock("./bridge", () => ({
  postToExtension: vi.fn(),
  onExtensionMessage: vi.fn((cb: (msg: unknown) => void) => {
    h.listeners.add(cb);
    return () => {
      h.listeners.delete(cb);
    };
  }),
}));

vi.mock("./components/PreviewContainer", async () => {
  const React = await import("react");
  return {
    PreviewContainer: React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        applyStyle: vi.fn(() => null),
        applyOp: vi.fn(() => null),
        reload: vi.fn(),
        markElement: vi.fn(),
        undo: vi.fn(),
        replayEdits: vi.fn(() => true),
      }));
      return React.createElement("div", { "data-testid": "preview-mock" });
    }),
  };
});

import { App } from "./App";

function extensionMessage(data: unknown): void {
  act(() => {
    for (const listener of h.listeners) listener(data);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.listeners.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App CSP fallback warning (IMP-B)", () => {
  it("shows the sandbox CSP fallback toast in Russian by default", () => {
    render(React.createElement(App));
    extensionMessage({ type: "preview:csp-fallback", target: "http://127.0.0.1:3000/" });
    expect(screen.getByText("CSP страницы снят: политика содержит sandbox, иначе runtime не выполнить")).toBeTruthy();
  });

  it("shows the English toast when the panel language is en", () => {
    render(React.createElement(App));
    extensionMessage({ type: "preview:state", url: "", status: "idle", language: "en" });
    extensionMessage({ type: "preview:csp-fallback", target: "http://127.0.0.1:3000/" });
    expect(screen.getByText("Page CSP removed: the policy contains sandbox, the runtime cannot run otherwise")).toBeTruthy();
  });
});