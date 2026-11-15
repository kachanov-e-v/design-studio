import type { ComponentInfo, ElementOp, ElementPayload, SourceRule } from "../../../packages/preview-runtime/src/protocol";
import type { SourceHint } from "../../infrastructure/ai-integrations/SourceHintFinder";

export interface ElementSelectionContext {
  selector: string;
  selectors?: string[];
  tag: string;
  styles: Record<string, string>;
  classes?: string[];
  id?: string;
  tailwind?: boolean;
  text?: string;
  rules?: SourceRule[];
  /** React owner components, nearest first; files resolved against the workspace. */
  components?: ComponentInfo[];
  sourceHints?: SourceHint[];
}

export function toSelectionContext(payload: ElementPayload, sourceHints?: SourceHint[]): ElementSelectionContext {
  const ctx: ElementSelectionContext = {
    selector: payload.selector,
    selectors: payload.selectors,
    tag: payload.tag,
    styles: payload.styles,
  };
  if (payload.text) ctx.text = payload.text;
  if (payload.classes && payload.classes.length > 0) ctx.classes = payload.classes;
  const idFromSelector = /^#([^.#\s>]+)$/.exec(payload.selector);
  if (idFromSelector) ctx.id = idFromSelector[1];
  if (payload.tailwind === true) ctx.tailwind = true;
  if (payload.rules && payload.rules.length > 0) ctx.rules = payload.rules;
  if (payload.component && payload.component.length > 0) ctx.components = payload.component;
  if (sourceHints && sourceHints.length > 0) ctx.sourceHints = sourceHints;
  return ctx;
}

function shortHref(href: string): string {
  // Dev-server hrefs often come through the Design Studio proxy; strip its prefix.
  const m = /\/proxy\/(https?:\/\/.+)/.exec(href);
  const clean = m ? m[1] : href;
  try {
    const u = new URL(clean);
    return u.pathname + u.search;
  } catch {
    return clean.length > 120 ? clean.slice(0, 117) + "..." : clean;
  }
}

export function contextToPrompt(ctx: ElementSelectionContext, instruction: string, op?: ElementOp): string {
  const styles = Object.entries(ctx.styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  const ownerChain = (ctx.components ?? [])
    .map((c) => c.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .join(" > ");
  const first = ctx.components?.find((c) => c.name || c.file);
  const componentLine =
    first && (first.name || first.file)
      ? `Component (React, dev owner): ${first.name ?? "<anonymous>"}${first.file ? ` — ${first.file}${first.line ? `:${first.line}` : ""}` : ""}`
      : null;
  const lines = [
    "Design Studio element context (v4)",
    `Element: ${ctx.tag}${ctx.id ? `#${ctx.id}` : ""}${ctx.classes?.length ? `.${ctx.classes.join(".")}` : ""} (${ctx.selector})`,
    componentLine,
    ownerChain && (ctx.components?.length ?? 0) > 1 ? `Owner chain: ${ownerChain}` : null,
    ctx.tailwind ? "Framework hint: Tailwind CSS detected — style changes should map to utility classes on the element." : null,
    ctx.text ? `Text: ${ctx.text}` : null,
    `Computed styles: ${styles}`,
    ctx.rules?.length
      ? `Matched CSS rules:\n${ctx.rules.map((r) => `- ${shortHref(r.href)} :: ${r.selectorText}`).join("\n")}`
      : null,
    ctx.sourceHints?.length
      ? [
          "Possible source locations (best-effort workspace search, verify by reading the files):",
          ...ctx.sourceHints.map((h) => `- ${h.file}:${h.line} — ${h.snippet} (matched ${h.token})`),
        ].join("\n")
      : null,
    op ? `Requested structural change: ${op}` : null,
    `Instruction: ${instruction}`,
    "",
    "Apply the requested change in the project source files.",
    "The full element snapshot (classes, selectors, rules) is in .design-studio/handoff.json — read it via the Design Studio MCP tool get_selected_element.",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}
