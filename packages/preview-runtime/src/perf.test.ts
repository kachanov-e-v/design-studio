import { describe, it, expect } from "vitest";
import { debugPerfEnabled, formatPerfSummary, PerfCollector } from "./perf";

describe("debugPerfEnabled", () => {
  it("enables only for dsPerf=1", () => {
    expect(debugPerfEnabled("?dsPerf=1")).toBe(true);
    expect(debugPerfEnabled("dsPerf=1")).toBe(true);
    expect(debugPerfEnabled("?route=/login&dsPerf=1")).toBe(true);
  });

  it("rejects missing, wrong and malformed values", () => {
    expect(debugPerfEnabled("")).toBe(false);
    expect(debugPerfEnabled(null)).toBe(false);
    expect(debugPerfEnabled(undefined)).toBe(false);
    expect(debugPerfEnabled("?dsPerf=0")).toBe(false);
    expect(debugPerfEnabled("?dsPerf=true")).toBe(false);
    expect(debugPerfEnabled("?%")).toBe(false);
  });
});

describe("PerfCollector", () => {
  it("records stages in order and returns their values", () => {
    const perf = new PerfCollector("select");
    const value = perf.stage("styles", () => 42);
    perf.stage("components", () => {
      const list = ["a", "b"];
      for (const item of list) list.includes(item);
      return list;
    });
    const summary = perf.finish();
    expect(value).toBe(42);
    expect(summary.label).toBe("select");
    expect(summary.stages.map((stage) => stage.name)).toEqual(["styles", "components"]);
    expect(summary.stages.every((stage) => stage.durationMs >= 0)).toBe(true);
    expect(summary.totalMs).toBeGreaterThanOrEqual(summary.stages.reduce((acc, stage) => acc + stage.durationMs, 0) - 0.001);
  });

  it("records a stage even when the callback throws", () => {
    const perf = new PerfCollector("select");
    expect(() => perf.stage("keys", () => { throw new Error("boom"); })).toThrow("boom");
    const summary = perf.finish();
    expect(summary.stages.map((stage) => stage.name)).toEqual(["keys"]);
  });

  it("does not mutate the internal list on finish", () => {
    const perf = new PerfCollector("select");
    perf.stage("one", () => undefined);
    const first = perf.finish();
    perf.stage("two", () => undefined);
    const second = perf.finish();
    expect(first.stages).toHaveLength(1);
    expect(second.stages).toHaveLength(2);
  });
});

describe("formatPerfSummary", () => {
  it("renders label, total and named stages on one line", () => {
    const line = formatPerfSummary({
      label: "select",
      totalMs: 1.234,
      stages: [
        { name: "styles", durationMs: 1 },
        { name: "components", durationMs: 0.2 },
      ],
    });
    expect(line).toContain("Design Studio perf [select]");
    expect(line).toContain("total=1.23ms");
    expect(line).toContain("styles=1.00ms");
    expect(line).toContain("components=0.20ms");
  });

  it("omits the stage list when empty", () => {
    const line = formatPerfSummary({ label: "select", totalMs: 0.5, stages: [] });
    expect(line.trimEnd()).toBe("Design Studio perf [select] total=0.50ms");
  });
});
