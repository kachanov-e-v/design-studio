import * as fs from "node:fs";
import * as path from "node:path";
import { DesignChangeStore } from "../journal/DesignChangeStore";
import { JOURNAL_DIRNAME } from "../journal/journalNames";

/**
 * Minimal MCP (Model Context Protocol, 2024-11-05) stdio server core exposing
 * the Design Studio change journal and element handoff to AI agents
 * (Kilo Code, Mistral Vibe; later OpenCode, Cline).
 *
 * Newline-delimited JSON-RPC 2.0 over stdio.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_NAME = "design-studio";
export const MCP_SERVER_VERSION = "0.2.0";

const TOOL_DEFINITIONS = [
  {
    name: "get_pending_changes",
    description:
      "List design changes made by the human in the Design Studio visual editor that are NOT yet applied to the project source files. Apply them to source and call acknowledge_changes for each.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_changes_since",
    description: "List design changes recorded since an ISO 8601 timestamp.",
    inputSchema: {
      type: "object",
      properties: { since: { type: "string", description: "ISO 8601 timestamp" } },
      required: ["since"],
    },
  },
  {
    name: "acknowledge_changes",
    description:
      "Mark pending design changes as applied to source. Call after you have reflected each change in the project files. Never call for changes you have not actually applied.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Change ids to acknowledge" },
      },
      required: ["ids"],
    },
  },
  {
    name: "get_selected_element",
    description:
      "Read the element the human selected in Design Studio and sent to your chat, with their instruction of what to change.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "complete_handoff",
    description: "Mark the sent element handoff as accepted by the agent.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_project_state",
    description: "Read the full Design Studio state document for this project (pending + committed design changes).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export interface McpCallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export class DesignStudioMcpCore {
  private readonly store: DesignChangeStore;

  constructor(
    private readonly workspaceRoot: string,
    private readonly serverInfo: { name: string; version: string } = { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }
  ) {
    this.store = new DesignChangeStore(workspaceRoot);
  }

  get journalDir(): string {
    return path.join(this.workspaceRoot, JOURNAL_DIRNAME);
  }

  /** Handle one JSON-RPC message; returns a response object or null for notifications/invalid input. */
  handleMessage(message: unknown): Record<string, unknown> | null {
    if (!message || typeof message !== "object") return null;
    const msg = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return null;
    const hasId = msg.id !== undefined && msg.id !== null;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    let result: unknown;
    switch (msg.method) {
      case "initialize":
        result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: this.serverInfo.name, version: this.serverInfo.version },
        };
        return hasId ? this.response(msg.id, result) : null;
      case "ping":
        return hasId ? this.response(msg.id, {}) : null;
      case "tools/list":
        result = { tools: TOOL_DEFINITIONS };
        return hasId ? this.response(msg.id, result) : null;
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        let callResult: McpCallResult;
        try {
          callResult = this.callTool(name, args);
        } catch (err) {
          callResult = {
            content: [{ type: "text", text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
        return hasId ? this.response(msg.id, callResult) : null;
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      default:
        if (!hasId) return null;
        return this.error(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  callTool(name: string, args: Record<string, unknown>): McpCallResult {
    switch (name) {
      case "get_pending_changes": {
        const pending = this.store.pendingChanges();
        return this.text(JSON.stringify({ count: pending.length, changes: pending }, null, 2));
      }
      case "get_changes_since": {
        const since = typeof args.since === "string" ? args.since : "";
        if (!since || Number.isNaN(Date.parse(since))) {
          return this.err("`since` must be an ISO 8601 timestamp");
        }
        const changes = this.store.changesSince(since);
        return this.text(JSON.stringify({ count: changes.length, changes }, null, 2));
      }
      case "acknowledge_changes": {
        const ids = Array.isArray(args.ids) ? args.ids.filter((v): v is string => typeof v === "string") : [];
        if (ids.length === 0) return this.err("`ids` must be a non-empty array of change ids");
        const ack = this.store.acknowledge(ids);
        this.store.refreshState();
        return this.text(JSON.stringify(ack, null, 2));
      }
      case "get_selected_element": {
        const handoff = this.store.readHandoff();
        if (!handoff) {
          return this.text(JSON.stringify({ none: true, hint: "No element sent from Design Studio yet." }, null, 2));
        }
        return this.text(JSON.stringify(handoff, null, 2));
      }
      case "complete_handoff": {
        const ok = this.store.completeHandoff();
        return this.text(JSON.stringify({ completed: ok }, null, 2));
      }
      case "get_project_state": {
        try {
          const text = fs.readFileSync(this.store.statePath, "utf8");
          return this.text(text);
        } catch {
          return this.text(`No Design Studio state yet at ${this.store.statePath}. The human has not saved design changes.`);
        }
      }
      default:
        return this.err(`Unknown tool: ${name}. Available: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}`);
    }
  }

  private text(text: string): McpCallResult {
    return { content: [{ type: "text", text }] };
  }

  private err(message: string): McpCallResult {
    return { content: [{ type: "text", text: message }], isError: true };
  }

  private response(id: unknown, result: unknown): Record<string, unknown> {
    return { jsonrpc: "2.0", id, result };
  }

  private error(id: unknown, code: number, message: string): Record<string, unknown> {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}
