import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Scan the bound project for previewable HTML entry points (.html/.htm).
 * Pure filesystem logic, kept free of the vscode API so hosts other than the
 * extension command (tests, tooling) can reuse it.
 */
export async function findProjectEntries(root: string): Promise<string[]> {
  const results: string[] = [];
  const excludedDirs = new Set(["node_modules", "dist", "build", ".git", ".vscode", ".next", "coverage", "out", "public", "static"]);
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || results.length >= 200) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
        continue;
      }
      if (entry.isFile() && !entry.name.startsWith(".")) {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
          const rel = path.relative(root, full).replace(/\\/g, "/");
          results.push(rel);
        }
      }
    }
  };
  walk(root, 0);
  results.sort((a, b) => {
    const at = path.basename(a).toLowerCase() === "index.html" || path.basename(a).toLowerCase() === "index.htm" ? 0 : 1;
    const bt = path.basename(b).toLowerCase() === "index.html" || path.basename(b).toLowerCase() === "index.htm" ? 0 : 1;
    if (at !== bt) return at - bt;
    return a.localeCompare(b);
  });
  return results;
}
