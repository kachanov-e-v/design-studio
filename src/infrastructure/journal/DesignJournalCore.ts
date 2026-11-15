import { designChangeToPrompt, type DesignChangeRecord } from "../../domain/entities/DesignChange";

/** Pure journal helpers — no fs, fully testable. */

export function parseChangesFile(text: string): DesignChangeRecord[] {
  const records: DesignChangeRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as DesignChangeRecord;
      if (parsed && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.ts === "string" && typeof parsed.kind === "string") {
        records.push(parsed);
      }
    } catch {
      // skip malformed line
    }
  }
  return records;
}

export function serializeChange(change: DesignChangeRecord): string {
  return JSON.stringify(change);
}

export function validateChange(change: unknown): DesignChangeRecord | null {
  if (!change || typeof change !== "object") return null;
  const c = change as Partial<DesignChangeRecord>;
  if (typeof c.id !== "string" || c.id.length === 0 || c.id.length > 128) return null;
  if (typeof c.ts !== "string" || Number.isNaN(Date.parse(c.ts))) return null;
  if (c.kind !== "style" && c.kind !== "text" && c.kind !== "structure") return null;
  if (typeof c.selector !== "string" || c.selector.length === 0 || c.selector.length > 500) return null;
  if (c.status !== "pending" && c.status !== "applied-to-source") return null;
  if (!c.details || typeof c.details !== "object") return null;
  return c as DesignChangeRecord;
}

export function buildStateMarkdown(
  pending: DesignChangeRecord[],
  recent: DesignChangeRecord[],
  workspaceLabel: string
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# Design Studio — state for AI agents");
  lines.push("");
  lines.push(`Project: ${workspaceLabel}`);
  lines.push(`Updated: ${now}`);
  lines.push("");
  lines.push("## IMPORTANT for AI agents");
  lines.push("");
  lines.push("- Changes below were made by a human through the Design Studio VS Code extension.");
  lines.push("- Items in \"Pending (agent must apply)\" are NOT yet reflected in the source files of this project.");
  lines.push("- Do NOT revert, remove, or overwrite these visual decisions while editing. Preserve them.");
  lines.push("- Apply pending items to the nearest relevant source (HTML/CSS/component) and then mark them acknowledged");
  lines.push("  through the Design Studio MCP server (`acknowledge_changes`).");
  lines.push("- After finishing work, re-read this file to confirm all pending items were handled.");
  lines.push("");
  lines.push("## Pending (agent must apply)");
  lines.push("");
  if (pending.length === 0) {
    lines.push("_No pending design changes._");
  } else {
    for (const change of pending) {
      lines.push(`- [${change.id}] (${change.kind}, ${change.ts}) ${designChangeToPrompt(change)}${change.note ? ` — ${change.note}` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Recently committed");
  lines.push("");
  if (recent.length === 0) {
    lines.push("_No committed changes recorded._");
  } else {
    for (const change of recent) {
      const file = change.file ? ` → \`${change.file}\`` : "";
      lines.push(`- [${change.id}] (${change.kind}, ${change.ts}) ${designChangeToPrompt(change)}${file}`);
    }
  }
  lines.push("");
  lines.push("Full journal: `.design-studio/changes.jsonl` (JSONL, one record per line).");
  lines.push("");
  return lines.join("\n");
}
