import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildStateMarkdown,
  parseChangesFile,
  validateChange,
} from "./DesignJournalCore";
import { HANDOFF_FILENAME, JOURNAL_DIRNAME, JOURNAL_FILENAME, STATE_FILENAME } from "./journalNames";
import type { DesignChangeRecord, ElementHandoff } from "../../domain/entities/DesignChange";
import type { ElementPayload } from "../../../packages/preview-runtime/src/protocol";

/**
 * Fs-backed design change journal bound to the workspace.
 * Everything an AI agent needs lives in `<workspaceRoot>/.design-studio/`.
 */
export class DesignChangeStore {
  readonly journalPath: string;
  readonly statePath: string;
  readonly handoffPath: string;

  constructor(private readonly workspaceRoot: string) {
    const dir = path.join(workspaceRoot, JOURNAL_DIRNAME);
    this.journalPath = path.join(dir, JOURNAL_FILENAME);
    this.statePath = path.join(dir, STATE_FILENAME);
    this.handoffPath = path.join(dir, HANDOFF_FILENAME);
  }

  private ensureDir(): string {
    const dir = path.join(this.workspaceRoot, JOURNAL_DIRNAME);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  readChanges(): DesignChangeRecord[] {
    let text: string;
    try {
      text = fs.readFileSync(this.journalPath, "utf8");
    } catch {
      return [];
    }
    return parseChangesFile(text).filter((c) => validateChange(c) !== null);
  }

  pendingChanges(): DesignChangeRecord[] {
    return this.readChanges().filter((c) => c.status === "pending");
  }

  changesSince(iso: string): DesignChangeRecord[] {
    const since = Date.parse(iso);
    if (Number.isNaN(since)) return [];
    return this.readChanges().filter((c) => Date.parse(c.ts) >= since);
  }

  recentChanges(limit = 20): DesignChangeRecord[] {
    return this.readChanges().slice(-limit).reverse();
  }

  recordStyleApplied(change: {
    selector: string;
    selectors?: string[];
    property: string;
    value: string;
    file?: string;
    note?: string;
  }): DesignChangeRecord {
    const record: DesignChangeRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      kind: "style",
      selector: change.selector,
      selectors: change.selectors,
      details: { property: change.property, value: change.value },
      status: "applied-to-source",
      file: change.file,
      note: change.note,
    };
    this.append([record]);
    return record;
  }

  recordPending(change: {
    kind: "text" | "structure" | "style";
    selector: string;
    selectors?: string[];
    op?: string;
    text?: string;
    classes?: string[];
    previousClasses?: string[];
    note?: string;
  }): DesignChangeRecord {
    if (change.kind === "style" && (!change.classes || change.classes.length === 0)) {
      throw new Error("Style class changes need a non-empty class list");
    }
    const record: DesignChangeRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      kind: change.kind,
      selector: change.selector,
      selectors: change.selectors,
      details: {
        op: change.op as never,
        text: change.text,
        classes: change.classes,
        previousClasses: change.previousClasses,
      },
      status: "pending",
      note: change.note,
    };
    this.append([record]);
    return record;
  }

  acknowledge(ids: string[]): { acknowledged: number; missing: string[] } {
    const changes = this.readChanges();
    const idSet = new Set(ids);
    let acknowledged = 0;
    const missing: string[] = [];
    for (const change of changes) {
      if (!idSet.has(change.id)) continue;
      if (change.status === "pending") {
        change.status = "applied-to-source";
        change.note = "acknowledged via Design Studio MCP";
        acknowledged += 1;
      } else {
        missing.push(change.id);
      }
    }
    for (const id of ids) {
      if (!changes.some((c) => c.id === id)) missing.push(id);
    }
    if (acknowledged > 0) {
      this.rewriteJournal(changes);
    }
    return { acknowledged, missing };
  }

  refreshState(workspaceLabel?: string): void {
    this.ensureDir();
    const changes = this.readChanges();
    const pending = changes.filter((c) => c.status === "pending");
    const recent = changes.filter((c) => c.status !== "pending").slice(-20).reverse();
    fs.writeFileSync(
      this.statePath,
      buildStateMarkdown(pending, recent, workspaceLabel ?? path.basename(this.workspaceRoot))
    );
  }

  writeHandoff(element: ElementPayload, instruction: string): ElementHandoff {
    this.ensureDir();
    const handoff: ElementHandoff = {
      ts: new Date().toISOString(),
      status: "new",
      element,
      instruction,
    };
    fs.writeFileSync(this.handoffPath, JSON.stringify(handoff, null, 2));
    return handoff;
  }

  readHandoff(): ElementHandoff | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.handoffPath, "utf8")) as ElementHandoff;
      if (parsed && typeof parsed === "object" && parsed.element && typeof parsed.instruction === "string") return parsed;
      return null;
    } catch {
      return null;
    }
  }

  completeHandoff(): boolean {
    const handoff = this.readHandoff();
    if (!handoff) return false;
    handoff.status = "accepted";
    fs.writeFileSync(this.handoffPath, JSON.stringify(handoff, null, 2));
    return true;
  }

  private append(records: DesignChangeRecord[]): void {
    this.ensureDir();
    fs.appendFileSync(this.journalPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    this.refreshState();
  }

  private rewriteJournal(changes: DesignChangeRecord[]): void {
    this.ensureDir();
    fs.writeFileSync(this.journalPath, changes.map((r) => JSON.stringify(r)).join("\n") + "\n");
    this.refreshState();
  }
}
