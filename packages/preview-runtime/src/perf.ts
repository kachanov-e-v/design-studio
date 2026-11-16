/**
 * Opt-in performance instrumentation for the select pipeline (EPIC E / H4).
 * Enabled only when the document URL carries `?dsPerf=1`, so production
 * preview pages keep the hot path untouched. Pure data + timing helpers;
 * the only browser-facing side effect is a `console.debug` line, and the
 * runtime never attaches timings to protocol payloads because the
 * ElementPayload validator is exact.
 */
export interface PerfStage {
  name: string;
  durationMs: number;
}

export interface PerfSummary {
  label: string;
  totalMs: number;
  stages: PerfStage[];
}

/** True when the debug profiling flag is present in the query string. */
export function debugPerfEnabled(search: string | null | undefined): boolean {
  if (!search) return false;
  try {
    const raw = search.startsWith("?") ? search : `?${search}`;
    return new URLSearchParams(raw).get("dsPerf") === "1";
  } catch {
    return false;
  }
}

/**
 * Measures named stages around synchronous work. Usage:
 *   const perf = new PerfCollector("select");
 *   const value = perf.stage("rules", () => collectRules(el));
 *   console.debug(formatPerfSummary(perf.finish()));
 */
export class PerfCollector {
  private stages: PerfStage[] = [];
  private readonly startedAt: number;

  constructor(private readonly label: string) {
    this.startedAt = performance.now();
  }

  stage<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.stages.push({ name, durationMs: performance.now() - start });
    }
  }

  finish(): PerfSummary {
    return { label: this.label, totalMs: performance.now() - this.startedAt, stages: [...this.stages] };
  }
}

/** Stable, human-readable one-line output for `console.debug`. */
export function formatPerfSummary(summary: PerfSummary): string {
  const stages = summary.stages.map((stage) => `${stage.name}=${stage.durationMs.toFixed(2)}ms`).join(" ");
  return `Design Studio perf [${summary.label}] total=${summary.totalMs.toFixed(2)}ms${stages ? ` ${stages}` : ""}`;
}
