import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { isAllowedUrl } from "../../shared/url";
import { KiloCodeAdapter } from "../../infrastructure/ai-integrations/kilo-code/KiloCodeAdapter";
import { StylePersistenceAdapter } from "../../infrastructure/persistence/StylePersistenceAdapter";
import type { DesignElementContext } from "../../domain/entities/DesignElementContext";

const PREVIEW_URL_KEY = "designStudio.previewUrl.v2";

export function openDesignStudio(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    "designStudio",
    "Design Studio",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  const adapter = new KiloCodeAdapter();
  const persistence = new StylePersistenceAdapter();

  const postState = () => {
    const url = context.workspaceState.get<string>(PREVIEW_URL_KEY, "");
    const status = url ? (url.includes("demo.html") ? "demo" : "configured") : "idle";
    panel.webview.postMessage({ type: "preview:state", url, status });
  };

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg || typeof msg.type !== "string") return;
      if (JSON.stringify(msg).length > 100000) return;

      if (msg.type === "preview:ready") {
        postState();
        return;
      }
      if (msg.type === "preview:demo") {
        const demoUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "demo.html"));
        console.log("Design Studio demo URI:", demoUri.toString());
        await context.workspaceState.update(PREVIEW_URL_KEY, demoUri.toString());
        postState();
        return;
      }
      if (msg.type === "preview:setUrl") {
        const url = typeof msg.url === "string" ? msg.url.trim() : "";
        if (url && !isAllowedUrl(url)) {
          panel.webview.postMessage({ type: "preview:error", message: "Invalid preview URL" });
          return;
        }
        await context.workspaceState.update(PREVIEW_URL_KEY, url);
        postState();
        return;
      }
      if (msg.type === "preview:refresh") {
        postState();
        return;
      }
      if (msg.type === "style:persist") {
        const change = {
          selector: String(msg.selector ?? ""),
          selectors: Array.isArray(msg.selectors) ? msg.selectors.map((s: unknown) => String(s)) : undefined,
          property: String(msg.property ?? ""),
          value: String(msg.value ?? ""),
        };
        const result = await persistence.apply(change);
        panel.webview.postMessage({ type: "persist:result", success: result.success, message: result.message, file: result.file });
        return;
      }
      if (msg.type === "kilo:sendContext") {
        const payload = msg.payload;
        const instruction = typeof msg.instruction === "string" ? msg.instruction : "";
        if (!payload) {
          panel.webview.postMessage({ type: "kilo:result", success: false, message: "No element selected" });
          return;
        }
        const ctx: DesignElementContext = {
          version: "1",
          selector: String(payload.selector ?? ""),
          tag: String(payload.tag ?? ""),
          styles: (payload.styles as Record<string, string>) ?? {},
          instruction,
        };
        const result = await adapter.sendContext(ctx, instruction);
        panel.webview.postMessage({ type: "kilo:result", success: result.success, message: result.message, method: result.method });
        return;
      }
    } catch {
      panel.webview.postMessage({ type: "error", message: "Internal error" });
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