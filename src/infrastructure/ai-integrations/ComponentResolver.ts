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
