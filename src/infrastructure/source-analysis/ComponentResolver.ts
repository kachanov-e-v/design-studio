import * as fs from "node:fs";
import * as path from "node:path";
import type { ComponentInfo } from "../../../packages/preview-runtime/src/protocol";

/**
 * Resolve bundler paths reported by the React dev fiber to workspace files.
 * Handles webpack-internal URLs, Turbopack "(group)/./app/..." prefixes,
 * Vite query suffixes (?t=123), absolute dev-server paths and plain relative paths.
 * Unresolvable files are passed through unchanged.
 */
export function resolveComponentPaths(root: string, components: ComponentInfo[] | undefined): ComponentInfo[] {
  if (!components || components.length === 0) return [];
  const cache = new Map<string, string | undefined>();
  return components.map((comp) => {
    if (!comp.file) return comp;
    const rel = resolveFile(root, comp.file, cache);
    return rel ? { ...comp, file: rel } : comp;
  });
}

export function stripBundlerPrefix(file: string): string {
  return (
    file
      .replace(/^[a-z][a-z0-9-]*:\/\/\//i, "")
      .replace(/^\(([^)]*)\)\//, "")
      .replace(/[?#].*$/, "")
      .replace(/\\/g, "/")
  );
}

/**
 * Pick the first component in the chain whose source file exists inside the
 * workspace. Library entries under node_modules are skipped so that "reveal"
 * opens application code, not bundled dependencies.
 */
export function pickRevealTarget(
  root: string,
  components: ComponentInfo[] | undefined
): ComponentInfo | undefined {
  if (!components || components.length === 0) return undefined;
  for (const comp of components) {
    if (!comp.file) continue;
    try {
      const resolved = resolveComponentPaths(root, [comp])[0] ?? comp;
      const rel = stripBundlerPrefix(resolved.file ?? "");
      const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel.replace(/^\.?\//, ""));
      const relative = path.relative(path.resolve(root), abs).replace(/\\/g, "/");
      if (!relative || relative === ".." || relative.startsWith("../")) continue;
      if (/(^|\/)node_modules\//.test(relative)) continue;
      if (!fs.statSync(abs).isFile()) continue;
      return { name: comp.name, file: abs, line: comp.line };
    } catch {
      // Skip unreadable candidates and try the next component.
    }
  }
  return undefined;
}

function resolveFile(root: string, raw: string, cache: Map<string, string | undefined>): string | undefined {
  if (cache.has(raw)) return cache.get(raw);
  const result = resolveUncached(root, raw);
  cache.set(raw, result);
  return result;
}

function resolveUncached(root: string, raw: string): string | undefined {
  const stripped = stripBundlerPrefix(raw);
  const candidates: string[] = [];
  if (path.isAbsolute(stripped)) {
    candidates.push(stripped);
  } else {
    candidates.push(path.join(root, stripped.replace(/^\.\//, "")));
  }
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        const rel = path.relative(root, candidate).replace(/\\/g, "/");
        if (rel.length > 0 && !rel.startsWith("..")) return rel;
        return undefined;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

// RT-02: React 19 dev drops `_debugSource` and Turbopack dev stacks surface
// only `chunks/` frames, so selections often carry component names WITHOUT a
// file. This definition scan backs up "reveal/copy component" for the
// name-only case. Mirrors SourceHintFinder's traversal discipline (skip
// build output and dot dirs, deterministic order, shared byte budget).
const DEFINITION_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js", ".mts", ".mjs"]);
const DEFINITION_SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", "build", "out", "coverage",
  ".git", ".vscode", ".design-studio",
]);
const MAX_DEFINITION_FILES = 3000;
const MAX_DEFINITION_FILE_BYTES = 300_000;
const MAX_DEFINITION_TOTAL_BYTES = 32 * 1024 * 1024;

export interface FindComponentDefinitionOptions {
  /** Overrides the shared read budget (bytes) — used by tests. */
  maxTotalBytes?: number;
}

const IDENTIFIER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const escapeRegExp = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function definitionPatterns(name: string): RegExp[] {
  const n = escapeRegExp(name);
  return [
    new RegExp(`\\bexport\\s+default\\s+(?:async\\s+)?function\\s+${n}\\b`),
    new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${n}\\b`),
    new RegExp(`\\bexport\\s+const\\s+${n}\\b`),
    new RegExp(`\\bexport\\s+class\\s+${n}\\b`),
    new RegExp(`\\b(?:async\\s+)?function\\s+${n}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*[:=][^=]`),
    new RegExp(`\\bclass\\s+${n}\\b`),
  ];
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Search the workspace for the definition of a component by its exact name.
 * Deterministic traversal order; reading stops once the shared byte budget
 * is spent (already-read files are still searched). Returns the first
 * definition site as a workspace-relative file.
 */
export async function findComponentDefinition(
  root: string,
  name: string,
  options: FindComponentDefinitionOptions = {}
): Promise<{ file: string; line?: number } | undefined> {
  if (!IDENTIFIER_NAME.test(name)) return undefined;
  const patterns = definitionPatterns(name);
  const maxTotalBytes = options.maxTotalBytes ?? MAX_DEFINITION_TOTAL_BYTES;
  let spentBytes = 0;
  let visited = 0;

  const walkDirs: string[] = [root];
  while (walkDirs.length > 0 && visited < MAX_DEFINITION_FILES) {
    const dir = walkDirs.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= MAX_DEFINITION_FILES) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!DEFINITION_SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walkDirs.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!DEFINITION_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      visited++;
      if (spentBytes >= maxTotalBytes) continue;
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size > MAX_DEFINITION_FILE_BYTES) continue;
        if (spentBytes + stat.size > maxTotalBytes) {
          // Never read past the shared budget; sizes still count so repeated
          // calls stay deterministic.
          spentBytes += stat.size;
          continue;
        }
        spentBytes += stat.size;
        const content = await fs.promises.readFile(full, "utf8");
        for (const pattern of patterns) {
          const match = pattern.exec(content);
          if (!match) continue;
          const rel = path.relative(root, full).replace(/\\/g, "/");
          // D-01: a file outside the workspace root invalidates only this file,
          // not the entire scan — skip it and keep walking.
          if (!rel || rel.startsWith("..")) break;
          return { file: rel, line: lineAt(content, match.index) };
        }
      } catch {
        // Skip unreadable files and keep scanning.
      }
    }
  }
  return undefined;
}
