import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { isLocalhostUrl } from "../../shared/url";
import { translate, type Language } from "../../shared/i18n";
import { PromptExportService } from "../../infrastructure/ai/PromptExportService";
import { StylePersistenceAdapter } from "../../infrastructure/persistence/StylePersistenceAdapter";
import { PreviewHostServer } from "../../infrastructure/preview/PreviewHostServer";
import { detectDevServers, type DevServerCandidate } from "../../infrastructure/preview/DevServerDetector";
import type { DesignEdit } from "../../domain/entities/DesignEdit";

const PROJECT_ENTRY_KEY = "designStudio.projectEntry.v3";
const DEV_SERVER_KEY = "designStudio.devServer.v3";
const LANGUAGE_KEY = "designStudio.language.v1";
const DEMO_KEY = "designStudio.demoPreview.v1";

let sharedHostServer: PreviewHostServer | null = null;
let sharedTraceChannel: vscode.OutputChannel | null = null;

function ensureTraceChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
  if (!sharedTraceChannel) {
    sharedTraceChannel = vscode.window.createOutputChannel("Design Studio Preview");
    context.subscriptions.push(sharedTraceChannel);
  }
  return sharedTraceChannel;
}

async function ensureHostServer(context: vscode.ExtensionContext, workspaceRoot: string | null): Promise<PreviewHostServer | null> {
  if (sharedHostServer?.running) {
    sharedHostServer.setProjectRoot(workspaceRoot);
    return sharedHostServer;
  }
  try {
    const traceChannel = ensureTraceChannel(context);
    const server = new PreviewHostServer({
      webviewRoot: path.join(context.extensionUri.fsPath, "dist", "webview"),
      projectRoot: workspaceRoot,
      trace: (line) => traceChannel.appendLine(`${new Date().toISOString()} ${line}`),
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
  let language: Language = context.globalState.get<Language>(LANGUAGE_KEY, "ru");
  const host = await ensureHostServer(context, root);

  const panel = vscode.window.createWebviewPanel(
    "designStudio",
    language === "ru" ? "Дизайн-студия" : "Design Studio",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  const persistence = new StylePersistenceAdapter();
  const promptExport = new PromptExportService(root);

  const projectUrl = (): string | null => {
    const entry = context.workspaceState.get<string>(PROJECT_ENTRY_KEY, "");
    return host && entry ? `${host.origin}/project/${entry}` : null;
  };

  const postState = async () => {
    const entry = context.workspaceState.get<string>(PROJECT_ENTRY_KEY, "");
    const devServer = context.workspaceState.get<string>(DEV_SERVER_KEY, "");
    const demo = context.workspaceState.get<boolean>(DEMO_KEY, false);
    const demoUrl = demo
      ? host
        ? `${host.origin}/demo.html?lang=${language}`
        : `${panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "demo.html"))}?lang=${language}`
      : "";
    const url = demo
      ? demoUrl
      : projectUrl() ?? (devServer && host ? `${host.origin}/proxy/${devServer}` : "");
    // Keep the host's sticky dev target in sync (see PreviewHostServer.setDevTarget).
    host?.setDevTarget(entry ? null : devServer || null);
    const entries = root ? await findProjectEntries(root) : [];
    const devServerSuggestions = entry || devServer
      ? [] as DevServerCandidate[]
      : root
        ? await detectDevServers(root, entries)
        : [] as DevServerCandidate[];
    panel.webview.postMessage({
      type: "preview:state",
      url,
      status: demo && url ? "demo" : url ? (url.includes("/project/") ? "project" : "devserver") : "idle",
      projectRoot: root,
      projectEntry: entry,
      projectEntries: entries,
      devServer,
      devServerSuggestions,
      language,
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
      if (msg.type === "ui:setLanguage") {
        language = msg.language === "en" ? "en" : "ru";
        await context.globalState.update(LANGUAGE_KEY, language);
        panel.title = language === "ru" ? "Дизайн-студия" : "Design Studio";
        await postState();
        return;
      }
      if (msg.type === "preview:demo") {
        await context.workspaceState.update(PROJECT_ENTRY_KEY, "");
        await context.workspaceState.update(DEV_SERVER_KEY, "");
        await context.workspaceState.update(DEMO_KEY, true);
        await postState();
        return;
      }
      if (msg.type === "project:setEntry") {
        const entry = typeof msg.path === "string" ? msg.path.replace(/\\/g, "/").replace(/^\//, "") : "";
        if (!entry || entry.includes("..")) {
          panel.webview.postMessage({ type: "preview:error", message: language === "ru" ? "Некорректный путь проекта" : "Invalid project entry" });
          return;
        }
        await context.workspaceState.update(PROJECT_ENTRY_KEY, entry);
        await context.workspaceState.update(DEV_SERVER_KEY, "");
        await context.workspaceState.update(DEMO_KEY, false);
        await postState();
        return;
      }
      if (msg.type === "project:setDevServer") {
        const url = typeof msg.url === "string" ? msg.url.trim() : "";
        if (url && !isLocalhostUrl(url)) {
          panel.webview.postMessage({
            type: "preview:error",
            message: language === "ru" ? "Разрешены только локальные серверы разработки проекта" : "Only localhost dev servers are allowed",
          });
          return;
        }
        const normalizedUrl = url ? new URL(url).toString() : "";
        await context.workspaceState.update(PROJECT_ENTRY_KEY, "");
        await context.workspaceState.update(DEV_SERVER_KEY, normalizedUrl);
        await context.workspaceState.update(DEMO_KEY, false);
        await postState();
        return;
      }
      if (msg.type === "project:navigate") {
        const rawUrl = typeof msg.url === "string" ? msg.url.trim() : "";
        if (!isLocalhostUrl(rawUrl)) {
          panel.webview.postMessage({
            type: "preview:error",
            message: language === "ru" ? "Разрешены только локальные адреса проекта" : "Only local project URLs are allowed",
          });
          return;
        }
        const url = new URL(rawUrl).toString();
        await context.workspaceState.update(PROJECT_ENTRY_KEY, "");
        await context.workspaceState.update(DEV_SERVER_KEY, url);
        await context.workspaceState.update(DEMO_KEY, false);
        await postState();
        return;
      }
      if (msg.type === "project:rememberNavigation") {
        const route = typeof msg.path === "string" ? msg.path : "";
        const current = context.workspaceState.get<string>(DEV_SERVER_KEY, "");
        if (!current || route.length > 4000 || !route.startsWith("/") || route.startsWith("//")) return;
        try {
          const origin = new URL(current).origin;
          const next = new URL(route, `${origin}/`);
          if (isLocalhostUrl(next.toString())) {
            await context.workspaceState.update(DEV_SERVER_KEY, next.toString());
            host?.setDevTarget(origin);
          }
        } catch {
          // Ignore malformed route updates from the preview frame.
        }
        return;
      }
      if (msg.type === "preview:refresh") {
        await postState();
        return;
      }
      if (msg.type === "style:persist") {
        if (!root) {
          panel.webview.postMessage({ type: "persist:result", success: false, message: translate(language, "status.noProject") });
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
          panel.webview.postMessage({
            type: "persist:result",
            success: true,
            message: translate(language, "status.styleSaved", { file: result.file ?? "" }),
            file: result.file,
          });
        } else {
          panel.webview.postMessage({
            type: "persist:result",
            success: false,
            message: translate(language, "status.saveFailed", { error: result.message }),
          });
        }
        return;
      }
      if (msg.type === "ai:copyInstruction") {
        if (!root) {
          panel.webview.postMessage({ type: "ai:result", success: false, message: translate(language, "status.noProject") });
          return;
        }
        const payload = msg.payload;
        const instruction = typeof msg.instruction === "string" ? msg.instruction : "";
        const edits = Array.isArray(msg.edits) ? msg.edits.slice(0, 200) as DesignEdit[] : [];
        if (payload !== undefined && payload !== null && (typeof payload !== "object" || typeof payload.selector !== "string")) {
          panel.webview.postMessage({ type: "ai:result", success: false, message: translate(language, "status.noSelection") });
          return;
        }
        if (!payload && !instruction.trim() && edits.length === 0) {
          panel.webview.postMessage({ type: "ai:result", success: false, message: translate(language, "status.noSelection") });
          return;
        }
        const result = await promptExport.copyInstruction(payload ?? null, instruction, edits, language);
        panel.webview.postMessage({
          type: "ai:result",
          success: result.success,
          message: result.message,
        });
        return;
      }
      if (msg.type === "ai:copyComponent") {
        const component = msg.component;
        if (!component || typeof component !== "object") {
          panel.webview.postMessage({ type: "ai:componentResult", success: false, message: translate(language, "status.sourceMissing") });
          return;
        }
        const result = await promptExport.copyComponent(component as { name?: string; file?: string; line?: number }, language);
        panel.webview.postMessage({
          type: "ai:componentResult",
          success: result.success,
          message: result.message,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : language === "ru" ? "Неизвестная ошибка" : "Unknown error";
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
