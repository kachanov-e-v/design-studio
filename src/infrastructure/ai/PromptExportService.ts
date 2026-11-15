import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ElementPayload } from "../../../packages/preview-runtime/src/protocol";
import type { DesignEdit } from "../../domain/entities/DesignEdit";
import { contextToPrompt, toSelectionContext } from "../../domain/entities/DesignElementContext";
import { translate, type Language } from "../../shared/i18n";
import { resolveComponentPaths } from "../source-analysis/ComponentResolver";
import { findSourceHints } from "../source-analysis/SourceHintFinder";

const MAX_COMPONENT_BYTES = 300_000;
const SOURCE_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js", ".mts", ".mjs", ".mdx"]);

export interface PromptExportResult {
  success: boolean;
  message: string;
}

export class PromptExportService {
  constructor(private readonly workspaceRoot: string | null) {}

  async copyInstruction(
    element: ElementPayload,
    instruction: string,
    edits: DesignEdit[],
    language: Language
  ): Promise<PromptExportResult> {
    if (!this.workspaceRoot) {
      return { success: false, message: translate(language, "status.noProject") };
    }

    let sourceHints: ReturnType<typeof findSourceHints> = [];
    try {
      sourceHints = findSourceHints(this.workspaceRoot, element);
    } catch {
      // Component metadata remains useful if workspace search is unavailable.
    }

    const context = toSelectionContext(element, sourceHints);
    const framework = this.detectFramework();
    if (context.components) {
      try {
        context.components = resolveComponentPaths(this.workspaceRoot, context.components);
      } catch {
        // Preserve bundler paths as a last resort.
      }
    }

    try {
      await vscode.env.clipboard.writeText(contextToPrompt(context, instruction, edits, language, framework));
      return { success: true, message: translate(language, "status.promptCopied") };
    } catch (error) {
      return {
        success: false,
        message: translate(language, "status.copyFailed", { error: error instanceof Error ? error.message : String(error) }),
      };
    }
  }

  async copyComponent(
    component: { name?: string; file?: string; line?: number },
    language: Language
  ): Promise<PromptExportResult> {
    if (!this.workspaceRoot) {
      return { success: false, message: translate(language, "status.noProject") };
    }
    if (!component.file) {
      return { success: false, message: translate(language, "status.sourceMissing") };
    }

    let sourceFile = component.file;
    try {
      sourceFile = resolveComponentPaths(this.workspaceRoot, [component])[0]?.file ?? sourceFile;
    } catch {
      // The direct bundler-path resolver below remains the fallback.
    }
    const filePath = this.resolveSourcePath(sourceFile);
    if (!filePath) {
      return { success: false, message: translate(language, "status.sourceMissing") };
    }

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_COMPONENT_BYTES) {
        return { success: false, message: translate(language, "status.sourceTooLarge") };
      }
      const source = fs.readFileSync(filePath, "utf8");
      const relative = path.relative(this.workspaceRoot, filePath).replace(/\\/g, "/");
      const fence = "`".repeat(Math.max(3, longestBacktickSequence(source) + 1));
      const languageHint = path.extname(filePath).slice(1);
      const header = language === "ru" ? "Исходный код выбранного компонента" : "Selected component source";
      const prompt = [
        `${header}: ${component.name ?? path.basename(filePath)} — ${relative}${component.line ? `:${component.line}` : ""}`,
        language === "ru"
          ? `Используй этот файл как контекст. Внеси только правки, которые я опишу в чате, сохранив соглашения проекта ${this.detectFramework()}.`
          : `Use this file as context. Apply only the changes I describe in chat, following the project's ${this.detectFramework()} conventions.`,
        "",
        `${fence}${languageHint}`,
        source,
        fence,
      ].join("\n");
      await vscode.env.clipboard.writeText(prompt);
      return { success: true, message: translate(language, "status.componentCopied") };
    } catch (error) {
      return {
        success: false,
        message: translate(language, "status.copyFailed", { error: error instanceof Error ? error.message : String(error) }),
      };
    }
  }

  private resolveSourcePath(source: string): string | null {
    if (!this.workspaceRoot) return null;
    const normalized = source
      .replace(/^[a-z][a-z0-9-]*:\/\/\//i, "")
      .replace(/^\(([^)]*)\)\//, "")
      .replace(/[?#].*$/, "")
      .replace(/\\/g, "/");
    const root = path.resolve(this.workspaceRoot);
    const candidates = /^[a-z]:[\\/]/i.test(normalized) || normalized.startsWith("\\\\")
      ? [path.resolve(normalized)]
      : normalized.startsWith("/")
        ? [path.resolve(root, normalized.replace(/^\/+/, "")), path.resolve(normalized)]
        : [path.resolve(root, normalized.replace(/^\.\//, ""))];
    for (const candidate of candidates) {
      const relative = path.relative(root, candidate);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) continue;
      try {
        const actual = fs.realpathSync(candidate);
        const actualRelative = path.relative(fs.realpathSync(root), actual);
        if (actualRelative && actualRelative !== ".." && !actualRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(actualRelative)) {
          return actual;
        }
      } catch {
        // Try the next workspace-relative candidate.
      }
    }
    return null;
  }

  private detectFramework(): string {
    if (!this.workspaceRoot) return "web application";
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, "package.json"), "utf8")) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      if (packageJson.dependencies?.next || packageJson.devDependencies?.next) return "Next.js";
      if (packageJson.dependencies?.react || packageJson.devDependencies?.react) return "React";
    } catch {
      // A project may not use npm or contain a package manifest.
    }
    return "web application";
  }
}

function longestBacktickSequence(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((sequence) => sequence.length));
}
