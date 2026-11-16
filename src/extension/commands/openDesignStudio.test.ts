/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  postMessage: vi.fn(async () => true),
  handler: null as ((msg: any) => Promise<void>) | null,
  disposeCb: null as (() => void) | null,
  copyInstruction: vi.fn(async () => ({ success: true, message: "copied" })),
  findProjectEntries: vi.fn(async () => ["index.html", "my page#1.html"]),
  detectDevServers: vi.fn(async () => []),
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

vi.mock("../../infrastructure/preview/PreviewHostServer", () => {
  const instances: any[] = [];
  const PreviewHostServer = class {
    static instances = instances;
    running = true;
    port = 0;
    start = vi.fn(async () => {
      this.port = 59999 + instances.length;
      return this.port;
    });
    stop = vi.fn(async () => {
      this.running = false;
    });
    setProjectRoot() {}
    setDevTarget() {}
    get origin() {
      return `http://127.0.0.1:${this.port}`;
    }
    constructor() {
      instances.push(this);
    }
  };
  return { PreviewHostServer };
});

vi.mock("../../infrastructure/persistence/StylePersistenceAdapter", () => ({
  StylePersistenceAdapter: class {
    apply = mocks.apply;
    async canEdit() {
      return true;
    }
  },
}));

vi.mock("../../infrastructure/ai/PromptExportService", () => ({
  PromptExportService: class {
    copyInstruction = mocks.copyInstruction;
    async revealComponent() {
      return { success: true, message: "" };
    }
  },
}));

vi.mock("../../infrastructure/preview/projectEntryScanner", () => ({
  findProjectEntries: mocks.findProjectEntries,
}));

vi.mock("../../infrastructure/preview/DevServerDetector", () => ({
  detectDevServers: mocks.detectDevServers,
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

  // P1-2: closing the (single) panel must stop the preview host and wipe its
  // session; reopening must start a fresh server, not resurrect the old one.
  it("P1-2: panel disposal stops the host and reopening starts a fresh one", async () => {
    const { PreviewHostServer } = (await import("../../infrastructure/preview/PreviewHostServer")) as any;
    PreviewHostServer.instances.length = 0;
    const ctx = makeContext();
    await openDesignStudio(ctx);
    expect(PreviewHostServer.instances).toHaveLength(1);
    const first = PreviewHostServer.instances[0];
    expect(first.start).toHaveBeenCalledTimes(1);

    mocks.disposeCb?.();
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(first.running).toBe(false);

    await openDesignStudio(makeContext());
    expect(PreviewHostServer.instances).toHaveLength(2);
    const second = PreviewHostServer.instances[1];
    expect(second.start).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
  });

  // P1-2: repeated open/close cycles must not pile up host dispose
  // subscriptions that each reference a dead server instance.
  it("P1-2: does not accumulate host dispose subscriptions across reopen cycles", async () => {
    const { PreviewHostServer } = (await import("../../infrastructure/preview/PreviewHostServer")) as any;
    PreviewHostServer.instances.length = 0;
    await openDesignStudio(makeContext());
    mocks.disposeCb?.();
    await openDesignStudio(makeContext());
    mocks.disposeCb?.();
    await openDesignStudio(makeContext());
    const instances = PreviewHostServer.instances as any[];
    expect(instances).toHaveLength(3);
    // The two earlier hosts were stopped exactly once (dispose or teardown);
    // only the newest one is still running.
    expect(instances[0].stop).toHaveBeenCalledTimes(1);
    expect(instances[1].stop).toHaveBeenCalledTimes(1);
    expect(instances[2].stop).not.toHaveBeenCalled();
    expect(instances[2].running).toBe(true);
  });

  // P1-5: webview edits are untrusted; the handler must re-validate and
  // truncate them before they reach the exported instruction.
  it("P1-5: sanitizes ai:copyInstruction edits (kind/limits)", async () => {
    await openDesignStudio(makeContext());
    await mocks.handler!({
      type: "ai:copyInstruction",
      instruction: "x",
      payload: null,
      edits: [
        { kind: "style", selector: "s".repeat(600), property: "color" },
        { kind: "nuclear", selector: ".dangerous" },
        "junk",
        null,
        { kind: "text", selector: ".ok", before: "a", after: "b", component: { name: "App", file: "f.tsx", line: 3 } },
      ],
    });
    expect(mocks.copyInstruction).toHaveBeenCalledTimes(1);
    const edits = (mocks.copyInstruction.mock.calls as unknown as any[][])[0][2] as any[];
    expect(edits).toHaveLength(2);
    expect(edits[0].selector).toHaveLength(500);
    expect(edits[0].kind).toBe("style");
    expect(edits[1].kind).toBe("text");
    expect(edits[1].component).toEqual({ name: "App", file: "f.tsx", line: 3 });
    expect(lastMessage().type).toBe("ai:result");
    expect(lastMessage().success).toBe(true);
  });
});

describe("postState state contract (P2-9/P2-10/P2-22)", () => {
  beforeEach(() => {
    mocks.findProjectEntries.mockClear();
    mocks.detectDevServers.mockClear();
    mocks.postMessage.mockClear();
    mocks.disposeCb?.();
    mocks.disposeCb = null;
    mocks.handler = null;
  });

  it("P2-9: encodes project entry path segments into the /project/ URL", async () => {
    await openDesignStudio(makeContext());
    await mocks.handler!({ type: "project:setEntry", path: "my page#1.html" });
    const state = lastMessage();
    expect(state.type).toBe("preview:state");
    expect(state.url).toContain("/project/my%20page%231.html");
    expect(state.status).toBe("project");
  });

  it("P2-10: a dev-server route path /project/x is classed as devserver, not project", async () => {
    await openDesignStudio(makeContext());
    await mocks.handler!({ type: "project:navigate", url: "http://localhost:3000/project/x" });
    const state = lastMessage();
    expect(state.status).toBe("devserver");
    expect(state.projectEntry).toBe("");
  });

  it("P2-10: demo and idle modes are reported explicitly", async () => {
    await openDesignStudio(makeContext());
    await mocks.handler!({ type: "preview:demo" });
    expect(lastMessage().status).toBe("demo");
    await mocks.handler!({ type: "project:setDevServer", url: "" });
    expect(lastMessage().status).toBe("idle");
  });

  it("P2-22: entry discovery is cached across postState calls and refreshed explicitly", async () => {
    await openDesignStudio(makeContext());
    await mocks.handler!({ type: "preview:ready" });
    expect(mocks.findProjectEntries).toHaveBeenCalledTimes(1);
    await mocks.handler!({ type: "ui:setLanguage", language: "en" });
    // Re-post without a refresh reuses the discovery results.
    expect(mocks.findProjectEntries).toHaveBeenCalledTimes(1);
    await mocks.handler!({ type: "preview:refresh" });
    // An explicit refresh invalidates the cache.
    expect(mocks.findProjectEntries).toHaveBeenCalledTimes(2);
  });
});

function mockApplySuccess(): void {
  (mocks.apply as Mock).mockResolvedValue({ success: true, message: "Saved to source", file: "app.module.css" });
}

function lastMessage(): any {
  const calls = mocks.postMessage.mock.calls as unknown as [msg: any][];
  return calls[calls.length - 1][0];
}
