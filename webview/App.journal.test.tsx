// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, screen, cleanup } from "@testing-library/react";
import type { DesignEdit } from "../src/domain/entities/DesignEdit";
import type { ElementPayload } from "./types";
import type { OpAppliedInfo } from "./components/PreviewContainer";

/**
 * IMP-A: the edit journal must survive a window reload (debounced journal:save
 * / journal:request / journal:loaded through the extension bridge) and every
 * replayable edit must be undoable via ds:replay with forget:true. The bridge
 * and the preview container are mocked so the test drives App directly.
 */

type MockContainerProps = {
  onLocationChange: (path: string) => void;
  onOpApplied: (info: OpAppliedInfo) => void;
  onRuntimeReady: () => void;
};

const h = vi.hoisted(() => ({
  listeners: new Set<(msg: unknown) => void>(),
  props: { current: null as MockContainerProps | null },
  handle: {
    applyStyle: vi.fn(() => null),
    applyOp: vi.fn(() => null),
    reload: vi.fn(),
    markElement: vi.fn(),
    undo: vi.fn(),
    replayEdits: vi.fn(() => true),
  },
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
    PreviewContainer: React.forwardRef((props: MockContainerProps, ref: React.Ref<unknown>) => {
      h.props.current = props;
      React.useImperativeHandle(ref, () => h.handle);
      return React.createElement("div", { "data-testid": "preview-mock" });
    }),
  };
});

import { App } from "./App";
import { postToExtension } from "./bridge";

type PostedMessage = { type?: string; path?: string; edits?: DesignEdit[] };

function posted(): PostedMessage[] {
  return vi.mocked(postToExtension).mock.calls.map((call) => call[0] as PostedMessage);
}

function extensionMessage(data: unknown): void {
  act(() => {
    for (const listener of h.listeners) listener(data);
  });
}

function elementPayload(selector: string): ElementPayload {
  return { selector, tag: "h1", rect: { top: 0, left: 0, width: 10, height: 10 }, styles: {} };
}

function navigate(path: string): void {
  act(() => {
    h.props.current!.onLocationChange(path);
  });
}

function recordTextEdit(selector: string): void {
  act(() => {
    h.props.current!.onOpApplied({ op: "set-text", value: "New text", success: true, payload: elementPayload(selector) });
  });
}

const styleEdit: DesignEdit = { kind: "style", selector: "h1", property: "color", before: "red", after: "blue" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.listeners.clear();
  h.props.current = null;
  h.handle.replayEdits.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App journal persistence (IMP-A)", () => {
  it("requests the journal on navigation and debounces saves with the current path", () => {
    render(React.createElement(App));
    navigate("/boards/a");
    expect(posted().some((msg) => msg.type === "journal:request" && msg.path === "/boards/a")).toBe(true);

    recordTextEdit("h1");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    recordTextEdit("h2");
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(posted().some((msg) => msg.type === "journal:save")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const saves = posted().filter((msg) => msg.type === "journal:save");
    expect(saves.length).toBe(1);
    expect(saves[0].path).toBe("/boards/a");
    expect(saves[0].edits).toEqual([
      { kind: "text", selector: "h1", before: "", after: "New text" },
      { kind: "text", selector: "h2", before: "", after: "New text" },
    ]);
  });

  it("does not save before a route is known", () => {
    render(React.createElement(App));
    recordTextEdit("h1");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(posted().some((msg) => msg.type === "journal:save")).toBe(false);
  });

  it("restores a loaded journal for the current route, marks and replays it", () => {
    render(React.createElement(App));
    navigate("/boards/a");
    extensionMessage({
      type: "journal:loaded",
      path: "/boards/a",
      edits: [styleEdit, { kind: "comment", selector: "h1", after: "note" }, { kind: "bogus", selector: "x" }, "junk"],
    });

    expect(screen.getByText("color: red → blue")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Отменить/ }).length).toBe(2);
    expect(h.handle.markElement).toHaveBeenCalledWith("h1", true);
    expect(h.handle.replayEdits).toHaveBeenCalledWith([{ kind: "style", selector: "h1", property: "color", value: "blue" }]);

    // A later runtime handshake replays the restored journal again (idempotent).
    h.handle.replayEdits.mockClear();
    act(() => {
      h.props.current!.onRuntimeReady();
    });
    expect(h.handle.replayEdits).toHaveBeenCalledWith([{ kind: "style", selector: "h1", property: "color", value: "blue" }]);
  });

  it("ignores journal:loaded when live edits exist", () => {
    render(React.createElement(App));
    navigate("/boards/a");
    recordTextEdit("h1");
    extensionMessage({ type: "journal:loaded", path: "/boards/a", edits: [styleEdit] });
    expect(screen.queryByText("color: red → blue")).toBeNull();
    expect(screen.getByText("Текст: — → New text")).toBeTruthy();
  });

  it("ignores journal:loaded for a different path", () => {
    render(React.createElement(App));
    navigate("/boards/a");
    extensionMessage({ type: "journal:loaded", path: "/other", edits: [styleEdit] });
    expect(screen.queryByText("color: red → blue")).toBeNull();
  });
});

describe("App journal undo (IMP-A)", () => {
  function restoreStyleEdit(): void {
    render(React.createElement(App));
    navigate("/boards/a");
    extensionMessage({ type: "journal:loaded", path: "/boards/a", edits: [styleEdit] });
  }

  it("undoes a style edit via ds:replay with forget:true and the before-value, then removes it", () => {
    restoreStyleEdit();
    h.handle.replayEdits.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Отменить правку" }));

    expect(h.handle.replayEdits).toHaveBeenCalledWith([
      { kind: "style", selector: "h1", property: "color", value: "red", forget: true },
    ]);
    expect(screen.queryByRole("button", { name: "Отменить правку" })).toBeNull();
    expect(h.handle.markElement).toHaveBeenCalledWith("h1", false);
    expect(screen.getByText("Правка отменена")).toBeTruthy();
  });

  it("keeps the entry and reports a failure when the runtime session is not up", () => {
    restoreStyleEdit();
    h.handle.replayEdits.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Отменить правку" }));
    expect(screen.getByRole("button", { name: "Отменить правку" })).toBeTruthy();
    expect(screen.getByText("Не удалось отменить правку")).toBeTruthy();
  });

  it("removes a comment entry without touching the runtime", () => {
    render(React.createElement(App));
    navigate("/boards/a");
    extensionMessage({ type: "journal:loaded", path: "/boards/a", edits: [{ kind: "comment", selector: "h1", after: "note" }] });
    h.handle.replayEdits.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Отменить правку" }));
    expect(h.handle.replayEdits).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Отменить правку" })).toBeNull();
    expect(screen.getByText("Правка отменена")).toBeTruthy();
  });

  it("routes a structure undo through the existing ds:undo handle path", () => {
    render(React.createElement(App));
    navigate("/boards/a");
    extensionMessage({
      type: "journal:loaded",
      path: "/boards/a",
      edits: [{ kind: "structure", selector: "h1", operation: "duplicate", requestId: "req-1" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Отменить структурную правку" }));
    expect(h.handle.undo).toHaveBeenCalledWith("req-1");
    expect(h.handle.replayEdits).not.toHaveBeenCalled();
  });
});