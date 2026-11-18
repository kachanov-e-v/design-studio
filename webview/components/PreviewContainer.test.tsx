// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { PreviewContainer, type PreviewContainerHandle } from "./PreviewContainer";

/**
 * WV-03: the first page of a demo/fresh project sometimes never reacts to
 * edit mode — the initial ds:set-mode push (sent the moment the runtime
 * announces itself) can be lost before the runtime session is fully up. The
 * container must keep re-sending set-mode until the runtime confirms with a
 * matching ds:mode-changed echo, then stop.
 */
describe("PreviewContainer mode resync (WV-03)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const fixedUuid = () => "fixed-session-id" as `${string}-${string}-${string}-${string}-${string}`;

  function renderWithIframe(propsExtra: Record<string, unknown> = {}) {
    const utils = render(
      React.createElement(PreviewContainer, {
        url: "http://127.0.0.1:4100/project/index.html",
        editMode: false,
        language: "ru" as const,
        status: "project",
        onEditModeChange: () => {},
        onRefresh: () => {},
        onNavigate: () => {},
        onLocationChange: () => {},
        onSelect: () => {},
        ...propsExtra,
      })
    );
    const iframe = utils.container.querySelector("iframe") as HTMLIFrameElement;
    return { ...utils, iframe };
  }

  function countSetMode(postSpy: { mock: { calls: unknown[][] } }): number {
    return postSpy.mock.calls.filter((call) => (call[0] as { type?: string }).type === "ds:set-mode").length;
  }

  it("keeps re-sending ds:set-mode until the runtime echoes mode-changed", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.useFakeTimers();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(fixedUuid());
    const { iframe } = renderWithIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    fireEvent(iframe, new Event("load"));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:runtime-ready", version: PROTOCOL_VERSION },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });

    // The ready branch and the [editMode, runtimeStatus, url] effect both push
    // set-mode once — two posts baseline. Without an echo the resync must keep
    // retrying (bounded), so the count grows over time.
    const baseline = countSetMode(postSpy);
    expect(baseline).toBeGreaterThanOrEqual(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(countSetMode(postSpy)).toBeGreaterThan(baseline);
  });

  it("stops re-sending once a matching mode-changed echo arrives", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.useFakeTimers();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(fixedUuid());
    const { iframe } = renderWithIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    fireEvent(iframe, new Event("load"));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:runtime-ready", version: PROTOCOL_VERSION },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:mode-changed", version: PROTOCOL_VERSION, enabled: false, sessionId: "fixed-session-id" },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });

    // The echo confirms the runtime heard us: the resync must stop growing
    // the post count beyond the initial pushes.
    const settled = countSetMode(postSpy);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(countSetMode(postSpy)).toBe(settled);
  });
});

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
    vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-session-id" as `${string}-${string}-${string}-${string}-${string}`);
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

describe("PreviewContainer edit-mode accent frame", () => {
  function renderSection(editMode: boolean) {
    return render(
      React.createElement(PreviewContainer, {
        url: "http://127.0.0.1:4100/project/index.html",
        editMode,
        language: "ru" as const,
        status: "project",
        onEditModeChange: () => {},
        onRefresh: () => {},
        onNavigate: () => {},
        onLocationChange: () => {},
        onSelect: () => {},
      })
    );
  }

  it("marks the preview frame while edit mode is on", () => {
    const { container, rerender } = renderSection(false);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).not.toContain("editing");
    rerender(
      React.createElement(PreviewContainer, {
        url: "http://127.0.0.1:4100/project/index.html",
        editMode: true,
        language: "ru" as const,
        status: "project",
        onEditModeChange: () => {},
        onRefresh: () => {},
        onNavigate: () => {},
        onLocationChange: () => {},
        onSelect: () => {},
      })
    );
    expect(section.className).toContain("editing");
  });
});

/**
 * IMP-A: journal replay — the handle posts ds:replay with the active session
 * and the pinned preview origin, refuses before the handshake, and surfaces
 * the runtime's ds:replayed summary through onReplayed.
 */
describe("PreviewContainer journal replay (IMP-A)", () => {
  afterEach(() => {
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

  const replayEdits = [{ kind: "style" as const, selector: "h1", property: "color", value: "blue" }];

  function renderWithRef(propsExtra: Record<string, unknown> = {}) {
    const ref = React.createRef<PreviewContainerHandle>();
    const utils = render(React.createElement(PreviewContainer, { ...baseProps, ...propsExtra, ref }));
    const iframe = utils.container.querySelector("iframe") as HTMLIFrameElement;
    return { ...utils, iframe, ref };
  }

  it("returns false and posts nothing before the handshake resolves", () => {
    const { iframe, ref } = renderWithRef();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");
    expect(ref.current?.replayEdits(replayEdits)).toBe(false);
    expect(postSpy.mock.calls.some((call) => (call[0] as { type?: string }).type === "ds:replay")).toBe(false);
  });

  it("posts ds:replay with the active sessionId and explicit targetOrigin after the handshake", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-session-id" as `${string}-${string}-${string}-${string}-${string}`);
    const { iframe, ref } = renderWithRef();
    fireEvent(iframe, new Event("load"));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:runtime-ready", version: PROTOCOL_VERSION },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    expect(ref.current?.replayEdits(replayEdits)).toBe(true);
    const replayCall = postSpy.mock.calls.find((call) => (call[0] as { type?: string }).type === "ds:replay");
    expect(replayCall).toBeDefined();
    expect(replayCall![0]).toEqual({
      type: "ds:replay",
      version: PROTOCOL_VERSION,
      edits: replayEdits,
      sessionId: "fixed-session-id",
    });
    expect(replayCall![1]).toBe("http://127.0.0.1:4100");
  });

  it("forwards a validated ds:replayed summary to onReplayed", async () => {
    const { PROTOCOL_VERSION } = await import("@design-studio/preview-runtime/protocol");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("fixed-session-id" as `${string}-${string}-${string}-${string}-${string}`);
    const onReplayed = vi.fn();
    const { iframe } = renderWithRef({ onReplayed });
    fireEvent(iframe, new Event("load"));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:runtime-ready", version: PROTOCOL_VERSION },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:replayed", version: PROTOCOL_VERSION, applied: 2, skipped: 1, sessionId: "fixed-session-id" },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });
    expect(onReplayed).toHaveBeenCalledWith({ applied: 2, skipped: 1 });

    // A foreign session id must not reach the callback.
    onReplayed.mockClear();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "ds:replayed", version: PROTOCOL_VERSION, applied: 9, skipped: 0, sessionId: "other-session" },
        origin: "http://127.0.0.1:4100",
        source: iframe.contentWindow,
      }));
    });
    expect(onReplayed).not.toHaveBeenCalled();
  });
});
