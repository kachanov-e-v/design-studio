// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, screen, cleanup } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@design-studio/preview-runtime/protocol";
import type { ElementPayload } from "./types";

afterEach(cleanup);

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

/**
 * Edit-journal fixes: comment dedupe/draft cleanup, mark replay after a
 * reload re-handshake, late style-applied selector guard, previousClasses
 * reset on failure, refresh-dialog focus management and structure undo.
 */
describe("App edit journal fixes", () => {
  const SESSION = "fixed-session-id";
  const ORIGIN = "http://127.0.0.1:4100";
  const PREVIEW_URL = `${ORIGIN}/boards/a`;

  function elementPayload(selector: string, extra: Partial<ElementPayload> = {}): ElementPayload {
    return { selector, tag: "div", rect: { top: 0, left: 0, width: 100, height: 50 }, styles: {}, ...extra };
  }

  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(SESSION as `${string}-${string}-${string}-${string}-${string}`);
    (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi = () => ({ postMessage: () => {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
  });

  async function setup() {
    const { App } = await import("./App");
    const utils = render(React.createElement(App));
    const { container } = utils;
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "preview:state", url: PREVIEW_URL, status: "project", language: "ru" } }));
    });
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");
    const runtime = (data: unknown) => {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: iframe.contentWindow as MessageEventSource }));
      });
    };
    runtime({ type: "ds:runtime-ready", version: PROTOCOL_VERSION });
    runtime({ type: "ds:mode-changed", version: PROTOCOL_VERSION, enabled: true, sessionId: SESSION });
    const select = (selector: string, extra: Partial<ElementPayload> = {}) =>
      runtime({ type: "ds:select", version: PROTOCOL_VERSION, sessionId: SESSION, payload: elementPayload(selector, extra) });
    return { ...utils, iframe, postSpy, runtime, select };
  }

  const addComment = (text: string) => {
    const textarea = screen.getByPlaceholderText("Что изменить в этом элементе") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: /Добавить в общую инструкцию|Добавлено ✓/ }));
    return textarea;
  };

  it("clears the popup draft and ignores a duplicate comment for the same selector", async () => {
    const { container, select } = await setup();
    select("div#hero");
    const textarea = addComment("Добавить тень");
    expect(textarea.value).toBe("");
    expect(container.querySelectorAll('li[title^="Комментарий"]').length).toBe(1);
    addComment("Добавить тень");
    expect(container.querySelectorAll('li[title^="Комментарий"]').length).toBe(1);
    addComment("Другой текст");
    expect(container.querySelectorAll('li[title^="Комментарий"]').length).toBe(2);
  });

  it("replays marks when the runtime re-announces itself after a reload", async () => {
    const { postSpy, runtime, select } = await setup();
    select("div#hero");
    addComment("Добавить тень");
    postSpy.mockClear();
    runtime({ type: "ds:runtime-ready", version: PROTOCOL_VERSION });
    const marks = postSpy.mock.calls
      .filter((call) => (call[0] as { type?: string }).type === "ds:mark")
      .map((call) => call[0] as { selector: string; marked: boolean });
    expect(marks).toContainEqual({ type: "ds:mark", version: PROTOCOL_VERSION, selector: "div#hero", marked: true, sessionId: SESSION });
  });

  it("does not overwrite the current selection with a late style-applied for another element", async () => {
    const { container, postSpy, runtime, select } = await setup();
    select("div#a", { styles: { color: "rgb(255, 0, 0)" } });
    fireEvent.click(screen.getByRole("button", { name: "Стили" }));
    const colorInput = screen.getByDisplayValue("rgb(255, 0, 0)");
    fireEvent.change(colorInput, { target: { value: "blue" } });
    fireEvent.keyDown(colorInput, { key: "Enter" });
    const applyCall = postSpy.mock.calls.find((call) => (call[0] as { type?: string }).type === "ds:apply-style");
    const requestId = (applyCall![0] as { requestId: string }).requestId;

    select("div#b");
    runtime({
      type: "ds:style-applied",
      version: PROTOCOL_VERSION,
      success: true,
      requestId,
      sessionId: SESSION,
      property: "color",
      value: "blue",
      payload: elementPayload("div#a", { styles: { color: "blue" } }),
    });
    expect(container.querySelector("code")?.textContent).toBe("div#b");
  });

  it("resets the classes baseline after a failed set-classes so the next edit gets the right before", async () => {
    const { container, runtime, select } = await setup();
    select("div#a", { classes: ["alpha"] });
    fireEvent.click(screen.getByRole("button", { name: "Классы" }));
    const classInput = screen.getByPlaceholderText("Классы через пробел");
    fireEvent.change(classInput, { target: { value: "beta" } });
    fireEvent.keyDown(classInput, { key: "Enter" });
    runtime({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "set-classes", value: "alpha beta", success: false, sessionId: SESSION });

    select("div#b", { classes: ["gamma"] });
    fireEvent.change(classInput, { target: { value: "delta" } });
    fireEvent.keyDown(classInput, { key: "Enter" });
    runtime({
      type: "ds:op-applied",
      version: PROTOCOL_VERSION,
      op: "set-classes",
      value: "gamma delta",
      success: true,
      sessionId: SESSION,
      payload: elementPayload("div#b", { classes: ["gamma", "delta"] }),
    });
    expect(container.querySelector('li[title^="Классы"]')?.getAttribute("title")).toBe("Классы: gamma → gamma delta");
  });

  it("refresh dialog: initial focus on Cancel, Tab trap, Escape closes and restores focus", async () => {
    const { runtime, select } = await setup();
    select("div#a");
    runtime({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "duplicate", success: true, requestId: "req-1", sessionId: SESSION, payload: elementPayload("div#a") });

    const refreshButton = screen.getByRole("button", { name: "Обновить" });
    refreshButton.focus();
    fireEvent.click(refreshButton);
    const dialog = screen.getByRole("alertdialog");
    const cancelButton = screen.getByRole("button", { name: "Отмена" });
    const continueButton = screen.getByRole("button", { name: "Продолжить" });
    expect(document.activeElement).toBe(cancelButton);

    continueButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancelButton);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(continueButton);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(refreshButton);
  });

  it("sends ds:undo, removes the edit on ds:undone and unmarks when no edits remain", async () => {
    const { postSpy, runtime, select } = await setup();
    select("div#a");
    runtime({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "duplicate", success: true, requestId: "req-1", sessionId: SESSION, payload: elementPayload("div#a") });

    fireEvent.click(screen.getByRole("button", { name: "Отменить структурную правку" }));
    const undoCall = postSpy.mock.calls.find((call) => (call[0] as { type?: string }).type === "ds:undo");
    expect(undoCall).toBeDefined();
    expect(undoCall![0]).toMatchObject({ type: "ds:undo", version: PROTOCOL_VERSION, requestId: "req-1", sessionId: SESSION });
    expect(undoCall![1]).toBe(ORIGIN);

    runtime({ type: "ds:undone", version: PROTOCOL_VERSION, requestId: "req-1", success: true, sessionId: SESSION });
    expect(screen.queryByRole("button", { name: "Отменить структурную правку" })).toBeNull();
    const unmark = postSpy.mock.calls.find((call) => {
      const msg = call[0] as { type?: string; selector?: string; marked?: boolean };
      return msg.type === "ds:mark" && msg.selector === "div#a" && msg.marked === false;
    });
    expect(unmark).toBeDefined();
    expect(screen.getByText("Структурная правка отменена")).toBeTruthy();
  });

  it("keeps the edit and reports a failure when ds:undone is unsuccessful", async () => {
    const { runtime, select } = await setup();
    select("div#a");
    runtime({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "duplicate", success: true, requestId: "req-2", sessionId: SESSION, payload: elementPayload("div#a") });
    fireEvent.click(screen.getByRole("button", { name: "Отменить структурную правку" }));
    runtime({ type: "ds:undone", version: PROTOCOL_VERSION, requestId: "req-2", success: false, sessionId: SESSION });
    expect(screen.getByRole("button", { name: "Отменить структурную правку" })).toBeTruthy();
    expect(screen.getByText("Не удалось отменить правку")).toBeTruthy();
  });
});
