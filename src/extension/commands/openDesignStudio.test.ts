/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  postMessage: vi.fn(async () => true),
  handler: null as ((msg: any) => Promise<void>) | null,
  disposeCb: null as (() => void) | null,
}));

vi.mock("vscode", () => {
  return {
    window: {
      createWebviewPanel: () => ({
        title: "",
        reveal: () => {},
        onDidDispose: (cb: () => void) => {
          mocks.disposeCb = cb;
          return { dispose() {} };
        },
        webview: {
          html: "",
          postMessage: mocks.postMessage,
          onDidReceiveMessage: (cb: (msg: any) => Promise<void>) => {
            mocks.handler = cb;
            return { dispose() {} };
          },
        },
      }),
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showErrorMessage: vi.fn(async () => undefined),
    },
    ViewColumn: { Beside: 2 },
    Uri: {
      joinPath: () => ({ fsPath: "/nonexistent/dist/webview" }),
      file: (p: string) => ({ fsPath: p }),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
    },
  };
});

vi.mock("../../infrastructure/preview/PreviewHostServer", () => ({
  PreviewHostServer: class {
    running = true;
    origin = "http://127.0.0.1:59999";
    async start() {
      return 59999;
    }
    async stop() {}
    setProjectRoot() {}
    setDevTarget() {}
  },
}));

vi.mock("../../infrastructure/persistence/StylePersistenceAdapter", () => ({
  StylePersistenceAdapter: class {
    apply = mocks.apply;
    async canEdit() {
      return true;
    }
  },
}));

// Store result returns the webview-built message verbatim.
import { buildStylePersistMessage } from "../../../webview/persistContract";
import { openDesignStudio } from "./openDesignStudio";

function makeContext(): any {
  const makeState = () => {
    const m = new Map<string, any>();
    return {
      get: (k: string, d: any) => (m.has(k) ? m.get(k) : d),
      update: async (k: string, v: any) => {
        m.set(k, v);
      },
    };
  };
  return {
    extensionUri: { fsPath: "/ext" },
    subscriptions: [],
    globalState: makeState(),
    workspaceState: makeState(),
  };
}

const sampleRules = [{ href: "http://localhost:3000/_next/static/css/app.css", selectorText: ".Button_btn__x1y2" }];

describe("style:persist extension handler (webview -> extension integration)", () => {
  beforeEach(() => {
    mocks.apply.mockReset();
    mocks.postMessage.mockClear();
    // Simulate closing the panel so each test opens a fresh one.
    mocks.disposeCb?.();
    mocks.disposeCb = null;
    mocks.handler = null;
  });

  it("persists sourceRules delivered by the webview payload", async () => {
    await openDesignStudio(makeContext());
    expect(mocks.handler).toBeTypeOf("function");
    mockApplySuccess();
    await mocks.handler!(
      buildStylePersistMessage({
        selector: ".Button_btn__x1y2",
        selectors: [".Button_btn__x1y2"],
        property: "color",
        value: "tomato",
        sourceRules: sampleRules,
      })
    );
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    const change = mocks.apply.mock.calls[0][0] as any;
    expect(change.sourceRules).toEqual(sampleRules);
    const last = lastMessage();
    expect(last.type).toBe("persist:result");
    expect(last.success).toBe(true);
  });

  it("does not invent sourceRules from a legacy `rules` field", async () => {
    await openDesignStudio(makeContext());
    mockApplySuccess();
    await mocks.handler!({ type: "style:persist", selector: ".x", property: "color", value: "red", rules: sampleRules });
    const change = mocks.apply.mock.calls[0][0] as any;
    expect(change.sourceRules).toBeUndefined();
    expect(change.property).toBe("color");
  });

  it("reports failure back to the webview when persistence fails", async () => {
    await openDesignStudio(makeContext());
    mocks.apply.mockResolvedValue({ success: false, message: "Ambiguous CSS rule match" });
    await mocks.handler!(buildStylePersistMessage({ selector: ".x", property: "color", value: "red" }));
    const last = lastMessage();
    expect(last.type).toBe("persist:result");
    expect(last.success).toBe(false);
  });

  it("A8: reveals the existing panel instead of creating a second one", async () => {
    const ctx = makeContext();
    await openDesignStudio(ctx);
    const handler = mocks.handler!;
    await openDesignStudio(makeContext());
    // The handler from the first panel is still registered; no new panel was created.
    expect(mocks.handler).toBe(handler);
    mockApplySuccess();
    await mocks.handler!(buildStylePersistMessage({ selector: ".x", property: "color", value: "red" }));
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(lastMessage().type).toBe("persist:result");
  });

  // P0-4: parallel style:persist messages must be applied strictly one at a
  // time, in arrival order, even when the underlying apply() resolves out of order.
  it("serializes concurrent persists in arrival order", async () => {
    await openDesignStudio(makeContext());
    // The unpersisted queue would resolve r3 first; deterministic behavior
    // still posts results in arrival order and never overlaps applies.
    let inflight = 0;
    let maxInflight = 0;
    mocks.apply.mockImplementation(
      ({ value }: { value: string }) =>
        new Promise<{ success: boolean; message: string }>((resolve) => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          const delay = value === "v-r1" ? 30 : value === "v-r2" ? 15 : 0;
          setTimeout(() => {
            inflight -= 1;
            resolve({ success: true, message: "Saved to source" });
          }, delay);
        })
    );
    const send = (requestId: string) =>
      mocks.handler!({ type: "style:persist", requestId, selector: ".x", property: "color", value: `v-${requestId}` });
    await Promise.all([send("r1"), send("r2"), send("r3")]);

    expect(mocks.apply).toHaveBeenCalledTimes(3);
    expect(maxInflight).toBe(1);
    const calls = mocks.postMessage.mock.calls as unknown as Array<[msg: { requestId?: string }]>;
    expect(calls.filter((c) => c[0].requestId).map((c) => c[0].requestId)).toEqual(["r1", "r2", "r3"]);
  });

  it("correlates persist:result with the requestId of the request", async () => {
    await openDesignStudio(makeContext());
    mockApplySuccess();
    await mocks.handler!({ type: "style:persist", requestId: "req-42", selector: ".x", property: "color", value: "red" });
    const last = lastMessage();
    expect(last.type).toBe("persist:result");
    expect(last.requestId).toBe("req-42");
  });
});

function mockApplySuccess(): void {
  (mocks.apply as Mock).mockResolvedValue({ success: true, message: "Saved to source", file: "app.module.css" });
}

function lastMessage(): any {
  const calls = mocks.postMessage.mock.calls as unknown as [msg: any][];
  return calls[calls.length - 1][0];
}
