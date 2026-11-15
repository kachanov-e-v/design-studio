import * as process from "node:process";
import * as fs from "node:fs";
import * as readline from "node:readline";
import { DesignStudioMcpCore } from "./DesignStudioMcpCore";

/**
 * Entry point for the Design Studio MCP stdio server.
 *
 * Usage: node mcp-server.js <workspaceRoot>
 * The workspace root is the human project this server reads the design
 * journal (`.design-studio/`) from.
 */

function resolveRoot(argv: string[]): string {
  const arg = argv.find((a) => !a.startsWith("-"));
  if (arg) return fs.realpathSync(arg);
  const cwd = process.cwd();
  return fs.realpathSync(cwd);
}

async function main(): Promise<void> {
  let root: string;
  try {
    root = resolveRoot(process.argv.slice(2));
  } catch (err) {
    console.error(`design-studio MCP server: invalid workspace root: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  const core = new DesignStudioMcpCore(root);
  const out = process.stdout;
  // Keep stdout strictly for JSON-RPC; diagnostics go to stderr.
  const send = (msg: Record<string, unknown>): void => {
    out.write(JSON.stringify(msg) + "\n");
  };

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    const response = core.handleMessage(parsed);
    if (response) send(response);
  });
  rl.on("close", () => {
    process.exit(0);
  });
}

void main();
