import * as fs from "node:fs";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import type { ElementPayload } from "../../../packages/preview-runtime/src/protocol";
import { isTailwindUtilityName } from "../../shared/tailwind";

export interface SourceHint {
  file: string;
  line: number;
  snippet: string;
  token: string;
}

const SEARCH_EXTENSIONS = new Set([
  ".tsx", ".jsx", ".ts", ".js", ".mts", ".mjs",
  ".vue", ".svelte", ".astro", ".html", ".htm", ".css", ".scss", ".mdx", ".md",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", "build", "out", "coverage",
  ".git", ".vscode", ".design-studio",
]);

const MAX_FILES = 3000;
const MAX_FILE_BYTES = 300_000;
// EXT-01: shared byte budget across the whole scan. Without it the worst case
// (MAX_FILES x MAX_FILE_BYTES, ~900 MB) was read into memory on every
// "Copy instruction".
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_HINTS = 8;

export interface FindSourceHintsOptions {
  /** Overrides the shared read budget (bytes) — used by tests. */
  maxTotalBytes?: number;
}

/**
 * Find likely source-file locations for a preview element by searching the
 * workspace for its distinctive tokens: visible text (whole snippet and
 * individual words), element id, and semantic (non-utility) class names.
 * Pure fs-based, no VS Code dependency; best-effort source hints for prompts.
 * Async and single-pass: every candidate file is read at most once, and the
 * reads happen off the extension-host critical path via fs/promises.
 */
export async function findSourceHints(
  root: string,
  payload: ElementPayload,
  options: FindSourceHintsOptions = {}
): Promise<SourceHint[]> {
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const tokens = collectTokens(payload);
  if (tokens.length === 0) return [];

  const files: string[] = [];
  const walkDirs: string[] = [root];
  while (walkDirs.length > 0 && files.length < MAX_FILES) {
    const dir = walkDirs.pop()!;
    let entries: Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walkDirs.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SEARCH_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(full);
      if (files.length >= MAX_FILES) break;
    }
  }

  // One read per file for the entire token loop: previously every file was
  // re-read for every token (thousands of synchronous reads on the UI thread).
  // Reads go in deterministic walk order under a shared byte budget (EXT-01):
  // once the budget is spent no NEW files are read, but the search still runs
  // over everything already read. With MAX_FILE_BYTES capping single files,
  // the total overshoot is at most one file.
  const contents = new Map<string, string>();
  let totalBytes = 0;
  for (const file of files) {
    if (totalBytes >= maxTotalBytes) break;
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      const content = await fs.promises.readFile(file, "utf8");
      totalBytes += content.length;
      contents.set(file, content);
    } catch {
      // Unreadable files simply yield no hints.
    }
  }

  const found: SourceHint[] = [];
  const seen = new Set<string>();
  // Search the most distinctive tokens first (exact text > id > semantic classes).
  for (const token of tokens) {
    for (const [file, text] of contents) {
      if (found.length >= MAX_HINTS) return rank(found);
      const idx = text.indexOf(token.search);
      if (idx === -1) continue;
      const line = countLines(text, idx);
      const rel = path.relative(root, file).replace(/\\/g, "/");
      const key = `${rel}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ file: rel, line, snippet: makeSnippet(text, idx), token: token.label });
    }
  }
  return rank(found);
}

function rank(hints: SourceHint[]): SourceHint[] {
  const codeFirst = (h: SourceHint) => /\.(tsx|jsx|vue|svelte)$/.test(h.file) ? 0 : 1;
  return [...hints]
    .sort((a, b) => codeFirst(a) - codeFirst(b) || a.file.localeCompare(b.file))
    .slice(0, MAX_HINTS);
}

interface SearchToken {
  label: string;
  search: string;
}

function collectTokens(payload: ElementPayload): SearchToken[] {
  const tokens: SearchToken[] = [];
  const push = (label: string, search: string) => {
    if (!search || search.length < 3) return;
    if (tokens.some((t) => t.search === search)) return;
    tokens.push({ label: shorten(label), search });
  };

  const text = (payload.text ?? "").trim();
  if (text) {
    push(`text "${text}"`, text.slice(0, 60));
    const words = [...text.split(/\s+/)].filter((w) => w.length >= 4).sort((a, b) => b.length - a.length).slice(0, 2);
    for (const w of words) push(`text word "${w}"`, w);
  }
  if (payload.classes) {
    const semantic = payload.classes.filter((c) => !isTailwindUtilityName(c) && !c.startsWith("ds-")).slice(0, 4);
    for (const cls of semantic) push(`class "${cls}"`, cls);
  }
  if (payload.selector?.startsWith("#")) push(`id "${payload.selector.slice(1)}"`, payload.selector.slice(1));
  return tokens.slice(0, 8);
}

function shorten(label: string): string {
  return label.length > 60 ? label.slice(0, 57) + "..." : label;
}

function countLines(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function makeSnippet(text: string, index: number): string {
  const raw = text.slice(index, index + 80).replace(/\s+/g, " ").trim();
  return raw.length > 0 ? raw : "(no content)";
}
