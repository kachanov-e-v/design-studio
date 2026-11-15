import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DesignStudioMcpCore, MCP_PROTOCOL_VERSION } from "./DesignStudioMcpCore";
import { DesignChangeStore } from "../journal/DesignChangeStore";
import { JOURNAL_DIRNAME } from "../journal/journalNames";

function makeCore(): { core: DesignStudioMcpCore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-mcp-"));
  return { core: new DesignStudioMcpCore(root), root };
}

function jsonResponse(msg: unknown): Record<string, unknown> {
  const resp = new DesignStudioMcpCore(os.tmpdir()).handleMessage(msg);
  expect(resp).not.toBeNull();
  return resp as Record<string, unknown>;
}

describe("DesignStudioMcpCore", () => {
  it("initializes with protocol capabilities", () => {
    const resp = jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
    });
    const result = resp.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo).toMatchObject({ name: "design-studio" });
  });

  it("lists tools", () => {
    const resp = jsonResponse({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (resp.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("get_pending_changes");
    expect(tools.length).toBeGreaterThanOrEqual(6);
  });

  it("returns pending changes as tool content", () => {
    const { core, root } = makeCore();
    const store = new DesignChangeStore(root);
    store.recordPending({ kind: "structure", selector: ".cta", op: "duplicate" });

    const resp = core.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_pending_changes", arguments: {} },
    }) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(resp.result.isError).toBeFalsy();
    const payload = JSON.parse(resp.result.content[0].text) as { count: number; changes: { selector: string }[] };
    expect(payload.count).toBe(1);
    expect(payload.changes[0].selector).toBe(".cta");
  });

  it("acknowledges changes through MCP", () => {
    const { core, root } = makeCore();
    const store = new DesignChangeStore(root);
    const change = store.recordPending({ kind: "text", selector: "h1", text: "New title" });

    const resp = core.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "acknowledge_changes", arguments: { ids: [change.id] } },
    }) as { result: { content: { text: string }[] } };
    const ack = JSON.parse(resp.result.content[0].text) as { acknowledged: number };
    expect(ack.acknowledged).toBe(1);
    expect(store.pendingChanges()).toHaveLength(0);
  });

  it("reads and completes element handoff through MCP", () => {
    const { core, root } = makeCore();
    const store = new DesignChangeStore(root);
    store.writeHandoff(
      {
        selector: "#login-card",
        tag: "div",
        rect: { top: 0, left: 0, width: 300, height: 200 },
        styles: {},
      },
      "center the card and add a shadow"
    );

    const read = core.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_selected_element", arguments: {} } }) as {
      result: { content: { text: string }[] };
    };
    const handoff = JSON.parse(read.result.content[0].text) as { instruction: string; element: { selector: string } };
    expect(handoff.instruction).toBe("center the card and add a shadow");
    expect(handoff.element.selector).toBe("#login-card");

    const done = core.handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "complete_handoff", arguments: {} } }) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(done.result.content[0].text).completed).toBe(true);
  });

  it("returns project state document", () => {
    const { core, root } = makeCore();
    new DesignChangeStore(root).recordStyleApplied({ selector: "body", property: "padding", value: "0", file: "main.css" });
    const resp = core.handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_project_state", arguments: {} } }) as {
      result: { content: { text: string }[] };
    };
    expect(resp.result.content[0].text).toContain("Design Studio — state for AI agents");
  });

  it("returns errors for unknown tools and invalid args", () => {
    const { core } = makeCore();
    const bad = core.handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope", arguments: {} } }) as {
      result: { isError: boolean };
    };
    expect(bad.result.isError).toBe(true);
    const badArgs = core.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_changes_since", arguments: {} } }) as {
      result: { isError: boolean };
    };
    expect(badArgs.result.isError).toBe(true);
  });

  it("ignores notifications and unknown methods without id", () => {
    const { core } = makeCore();
    expect(core.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(core.handleMessage({ jsonrpc: "2.0", method: "mystery" })).toBeNull();
    expect(core.handleMessage({ jsonrpc: "2.0", id: 10, method: "mystery" })).toMatchObject({ error: { code: -32601 } });
    expect(core.handleMessage("junk")).toBeNull();
  });

  it("journal dir sits inside the bound workspace", () => {
    const { core, root } = makeCore();
    expect(core.journalDir).toBe(path.join(root, JOURNAL_DIRNAME));
  });
});
