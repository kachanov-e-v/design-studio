/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  postMessage: vi.fn(async () => true),
  handler: null as ((msg: any) => Promise<void>) | null,
}));

vi.mock("vscode", () => {
  return {
    window: {
      createWebviewPanel: () => ({
        title: "",
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
});

function mockApplySuccess(): void {
  (mocks.apply as Mock).mockResolvedValue({ success: true, message: "Saved to source", file: "app.module.css" });
}

function lastMessage(): any {
  const calls = mocks.postMessage.mock.calls as unknown as [msg: any][];
  return calls[calls.length - 1][0];
}
