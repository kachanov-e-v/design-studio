import { describe, expect, it } from "vitest";
import { buildStateMarkdown, parseChangesFile, validateChange } from "./DesignJournalCore";
import type { DesignChangeRecord } from "../../domain/entities/DesignChange";

const record = (overrides: Partial<DesignChangeRecord> = {}): DesignChangeRecord => ({
  id: "id-1",
  ts: "2025-01-01T00:00:00.000Z",
  kind: "structure",
  selector: "div.card",
  details: { op: "delete" },
  status: "pending",
  ...overrides,
});

describe("DesignJournalCore", () => {
  it("parses JSONL skipping malformed lines", () => {
    const text = [
      JSON.stringify(record()),
      "{not json",
      JSON.stringify({ nope: true }),
      "",
      JSON.stringify(record({ id: "id-2", kind: "style", status: "applied-to-source", details: { property: "color", value: "red" } })),
    ].join("\n");
    const parsed = parseChangesFile(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("id-1");
    expect(parsed[1].details.property).toBe("color");
  });

  it("validateChange rejects invalid records", () => {
    expect(validateChange(record())).not.toBeNull();
    expect(validateChange(record({ id: "" }))).toBeNull();
    expect(validateChange(record({ ts: "nope" }))).toBeNull();
    expect(validateChange(record({ kind: "bogus" as never }))).toBeNull();
    expect(validateChange(record({ status: "unknown" as never }))).toBeNull();
    expect(validateChange(record({ selector: "" }))).toBeNull();
    expect(validateChange({})).toBeNull();
    expect(validateChange(null)).toBeNull();
  });

  it("buildStateMarkdown contains pending items and agent instructions", () => {
    const pending = record({ id: "p-1", note: "made visually" });
    const applied = record({ id: "c-1", status: "applied-to-source", file: "styles.css", kind: "style", details: { property: "color", value: "red" } });
    const md = buildStateMarkdown([pending], [applied], "my-project");
    expect(md).toContain("my-project");
    expect(md).toContain("p-1");
    expect(md).toContain("apply structure op delete on div.card");
    expect(md).toContain("made visually");
    expect(md).toContain("Recently committed");
    expect(md).toContain("styles.css");
    expect(md).toContain("changes.jsonl");
    expect(md).toContain("Do NOT revert");
  });

  it("buildStateMarkdown handles empty journal", () => {
    const md = buildStateMarkdown([], [], "empty");
    expect(md).toContain("_No pending design changes._");
    expect(md).toContain("_No committed changes recorded._");
  });
});
