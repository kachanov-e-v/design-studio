import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { isLocalhostUrl } from "../../shared/url";
import { AgentHandoffService } from "../../infrastructure/ai-integrations/AgentHandoffService";
import { StylePersistenceAdapter } from "../../infrastructure/persistence/StylePersistenceAdapter";
import { applyStructureOp } from "../../infrastructure/persistence/HtmlStructureEditor";
import { DesignChangeStore } from "../../infrastructure/journal/DesignChangeStore";
import { PreviewHostServer } from "../../infrastructure/preview/PreviewHostServer";
import { detectDevServers, type DevServerCandidate } from "../../infrastructure/preview/DevServerDetector";
import type { DesignChangeKind } from "../../domain/entities/DesignChange";

const PROJECT_ENTRY_KEY = "designStudio.projectEntry.v3";
const DEV_SERVER_KEY = "designStudio.devServer.v3";

let sharedHostServer: PreviewHostServer | null = null;

const AGENT_CHAT_COMMANDS: Record<string, string[]> = {
  "Kilo Code": ["kilo-code.new.openInTab", "kilo-code.new.focusChatInput", "kilo-code.*"],
  "Mistral Vibe": ["mistral-vibe.*", "vibe.*"],
};

async function ensureHostServer(context: vscode.ExtensionContext, workspaceRoot: string | null): Promise<PreviewHostServer | null> {
  if (sharedHostServer?.running) {
    sharedHostServer.setProjectRoot(workspaceRoot);
    return sharedHostServer;
  }
  try {
    const server = new PreviewHostServer({
      webviewRoot: path.join(context.extensionUri.fsPath, "dist", "webview"),
      projectRoot: workspaceRoot,
    });
    await server.start();
    sharedHostServer = server;
    context.subscriptions.push({ dispose: () => void server.stop() });
    return server;
  } catch (err) {
    console.error("Design Studio: failed to start preview host server:", err);
    return null;
  }
}

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

/**
 * Apply a structural block op directly to the bound project's HTML entry
 * file (static projects only). Returns null when the entry is not set, the
 * file is unreadable, or the element cannot be resolved unambiguously — the
 * caller then falls back to the pending journal (agent path).
 */
function tryApplyStructureToSource(
  root: string,
  entry: string,
  op: "delete" | "duplicate" | "move-up" | "move-down",
  selectors: string[]
): { file: string; message: string } | null {
  if (!entry || entry.includes("..")) return null;
  const file = path.join(root, entry);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let next: string | null;
  try {
    next = applyStructureOp(text, op, selectors);
  } catch {
    return null;
  }
  if (next === null || next === text) return null;
  try {
    fs.writeFileSync(file, next, "utf8");
  } catch {
    return null;
  }
  return { file: entry, message: `${op} applied to ${entry}` };
}

/** Scan the bound project for previewable HTML entry points. */
export async function findProjectEntries(root: string): Promise<string[]> {
  const results: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || results.length >= 100) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "build", ".git", ".vscode", ".next", "coverage"].includes(entry.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".html") && !entry.name.startsWith(".")) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        results.push(rel);
      }
    }
  };
  walk(root, 0);
  results.sort((a, b) => {
    const at = path.basename(a).toLowerCase() === "index.html" ? 0 : 1;
    const bt = path.basename(b).toLowerCase() === "index.html" ? 0 : 1;
    if (at !== bt) return at - bt;
    return a.localeCompare(b);
  });
  return results;
}

export async function openDesignStudio(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const host = await ensureHostServer(context, root);

  const panel = vscode.window.createWebviewPanel(
    "designStudio",
    "Design Studio",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  const store = root ? new DesignChangeStore(root) : null;
  const persistence = new StylePersistenceAdapter();
  const handoffService = new AgentHandoffService(store, AGENT_CHAT_COMMANDS, root);

  const projectUrl = (): string | null => {
    const entry = context.workspaceState.get<string>(PROJECT_ENTRY_KEY, "");
    return host && entry ? `${host.origin}/project/${entry}` : null;
  };

  const postState = async () => {
    const entry = context.workspaceState.get<string>(PROJECT_ENTRY_KEY, "");
    const devServer = context.workspaceState.get<string>(DEV_SERVER_KEY, "");
    const url = projectUrl() ?? (devServer && host ? `${host.origin}/proxy/${devServer}` : "");
    const entries = root ? await findProjectEntries(root) : [];
    const [pending, devServerSuggestions] = await Promise.all([
      Promise.resolve(store ? store.pendingChanges().length : 0),
      entry || devServer
        ? Promise.resolve([] as DevServerCandidate[])
        : root
          ? detectDevServers(root, entries)
          : Promise.resolve([] as DevServerCandidate[]),
    ]);
    panel.webview.postMessage({
      type: "preview:state",
      url,
      status: url ? (url.includes("/project/") ? "project" : "devserver") : "idle",
      projectRoot: root,
      projectEntry: entry,
      projectEntries: entries,
      devServer,
      devServerSuggestions,
      pendingChanges: pending,
    });
  };

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg || typeof msg.type !== "string") return;
      if (JSON.stringify(msg).length > 300_000) return;

      if (msg.type === "preview:ready") {
        await postState();
        return;
      }
      if (msg.type === "preview:demo") {
        let url: string;
        if (host) {
          url = `${host.origin}/demo.html`;
        } else {
          url = panel.webview
            .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "demo.html"))
            .toString();
        }
        await context.workspaceState.update(PROJECT_ENTRY_KEY, "");
        await context.workspaceState.update(DEV_SERVER_KEY, "");
        panel.webview.postMessage({ type: "preview:state", url, status: "demo", projectEntries: [] });
        return;
      }
      if (msg.type === "project:setEntry") {
        const entry = typeof msg.path === "string" ? msg.path.replace(/\\/g, "/").replace(/^\//, "") : "";
        if (!entry || entry.includes("..")) {
          panel.webview.postMessage({ type: "preview:error", message: "Invalid project entry" });
          return;
        }
        await context.workspaceState.update(PROJECT_ENTRY_KEY, entry);
        await context.workspaceState.update(DEV_SERVER_KEY, "");
        await postState();
        return;
      }
      if (msg.type === "project:setDevServer") {
        const url = typeof msg.url === "string" ? msg.url.trim() : "";
        if (url && !isLocalhostUrl(url)) {
          panel.webview.postMessage({
            type: "preview:error",
            message: "Only localhost dev servers of this project are allowed",
          });
          return;
        }
        await context.workspaceState.update(PROJECT_ENTRY_KEY, "");
        await context.workspaceState.update(DEV_SERVER_KEY, url);
        await postState();
        return;
      }
      if (msg.type === "preview:refresh") {
        await postState();
        return;
      }
      if (msg.type === "style:persist") {
        if (!store) {
          panel.webview.postMessage({ type: "persist:result", success: false, message: "Open a project folder first" });
          return;
        }
        const change = {
          selector: String(msg.selector ?? ""),
          selectors: Array.isArray(msg.selectors) ? msg.selectors.map((s: unknown) => String(s)) : undefined,
          property: String(msg.property ?? ""),
          value: String(msg.value ?? ""),
          sourceRules: Array.isArray(msg.sourceRules)
            ? msg.sourceRules
                .slice(0, 8)
                .filter((r: unknown): r is { href: string; selectorText: string } => {
                  const rule = r as { href?: unknown; selectorText?: unknown };
                  return (
                    typeof rule?.href === "string" &&
                    typeof rule?.selectorText === "string" &&
                    rule.href.length > 0 &&
                    rule.selectorText.length > 0
                  );
                })
            : undefined,
        };
        const result = await persistence.apply(change);
        if (result.success) {
          const record = store.recordStyleApplied({ ...change, file: result.file });
          panel.webview.postMessage({
            type: "persist:result",
            success: true,
            message: `${result.message} (recorded ${record.id.slice(0, 8)})`,
            file: result.file,
            changeId: record.id,
          });
        } else {
          panel.webview.postMessage({ type: "persist:result", success: false, message: result.message });
        }
        return;
      }
      if (msg.type === "journal:recordChange") {
        if (!store) {
          panel.webview.postMessage({ type: "journal:result", success: false, message: "Open a project folder first" });
          return;
        }
        const kind = msg.kind as DesignChangeKind;
        const selector = String(msg.selector ?? "");
        if (!kind || !selector) {
          panel.webview.postMessage({ type: "journal:result", success: false, message: "Invalid change record" });
          return;
        }
        const selectors = Array.isArray(msg.selectors) ? msg.selectors.map((s: unknown) => String(s)) : undefined;
        if (root && kind === "structure" && typeof msg.op === "string" && (msg.op === "delete" || msg.op === "duplicate" || msg.op === "move-up" || msg.op === "move-down")) {
          const applied = tryApplyStructureToSource(root, context.workspaceState.get<string>(PROJECT_ENTRY_KEY, ""), msg.op, selectors ?? []);
          if (applied) {
            const record = store.recordStructureApplied({
              selector,
              selectors,
              op: msg.op,
              file: applied.file,
              note: "applied directly to the HTML source by Design Studio",
            });
            panel.webview.postMessage({
              type: "journal:result",
              success: true,
              message: `${applied.message} (recorded ${record.id.slice(0, 8)})`,
              changeId: record.id,
              pendingChanges: store.pendingChanges().length,
              file: applied.file,
            });
            return;
          }
        }
        if (kind === "style") {
          const classes = Array.isArray(msg.classes)
            ? msg.classes.slice(0, 30).map((c: unknown) => String(c)).filter((c: string) => c.length > 0 && c.length <= 100)
            : [];
          if (classes.length === 0) {
            panel.webview.postMessage({ type: "journal:result", success: false, message: "Style class changes need a class list" });
            return;
          }
          const record = store.recordPending({
            kind: "style",
            selector,
            selectors,
            classes,
            previousClasses: Array.isArray(msg.previousClasses)
              ? msg.previousClasses.slice(0, 30).map((c: unknown) => String(c))
              : undefined,
            note: "Tailwind class change made visually in Design Studio, not yet in source",
          });
          panel.webview.postMessage({
            type: "journal:result",
            success: true,
            message: `Recorded pending change ${record.id.slice(0, 8)} — your AI agent will pick it up`,
            changeId: record.id,
            pendingChanges: store.pendingChanges().length,
          });
          return;
        }
        const record = store.recordPending({
          kind: kind === "text" ? "text" : "structure",
          selector,
          selectors,
          op: typeof msg.op === "string" ? msg.op : undefined,
          text: typeof msg.text === "string" ? msg.text : undefined,
          note: "made visually in Design Studio, not yet in source",
        });
        panel.webview.postMessage({
          type: "journal:result",
          success: true,
          message: `Recorded pending change ${record.id.slice(0, 8)} — your AI agent will pick it up`,
          changeId: record.id,
          pendingChanges: store.pendingChanges().length,
        });
        return;
      }
      if (msg.type === "ai:sendElement") {
        if (!store) {
          panel.webview.postMessage({ type: "ai:result", success: false, message: "Open a project folder first" });
          return;
        }
        const payload = msg.payload;
        const instruction = typeof msg.instruction === "string" ? msg.instruction : "";
        if (!payload || typeof payload.selector !== "string") {
          panel.webview.postMessage({ type: "ai:result", success: false, message: "No element selected" });
          return;
        }
        const result = await handoffService.send(payload, instruction);
        panel.webview.postMessage({
          type: "ai:result",
          success: result.success,
          message: result.message,
          agents: result.agents,
        });
        return;
      }
      if (msg.type === "mcp:copyConfig") {
        if (!root) {
          panel.webview.postMessage({ type: "mcp:result", success: false, message: "Open a project folder first" });
          return;
        }
        const serverJs = path.join(context.extensionUri.fsPath, "dist", "mcp-server.js");
        const config = {
          mcpServers: {
            "design-studio": {
              command: "node",
              args: [serverJs, root],
            },
          },
        };
        await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
        panel.webview.postMessage({
          type: "mcp:result",
          success: true,
          message: "MCP config copied. Add it to the Kilo Code / Mistral Vibe MCP settings and reload.",
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      panel.webview.postMessage({ type: "error", message });
    }
  });
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const webviewRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  const indexPath = path.join(webviewRoot.fsPath, "index.html");

  let html: string;
  try {
    html = fs.readFileSync(indexPath, "utf8");
  } catch {
    return `<!DOCTYPE html><html><body><h1>Design Studio</h1><p>Webview build not found. Run npm run build:webview.</p></body></html>`;
  }

  const baseUri = webview.asWebviewUri(webviewRoot);
  html = html.replace(/(src|href)="\/([^"]+)"/g, (_m, attr, p) => `${attr}="${baseUri}/${p}"`);
  html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_m, attr, p) => `${attr}="${baseUri}/${p}"`);

  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; frame-src ${webview.cspSource} http: https: data:;" />`;
  if (!html.includes("Content-Security-Policy")) {
    html = html.replace("<head>", `<head>${csp}`);
  }

  return html;
}
