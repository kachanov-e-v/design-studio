import type { ElementOp, ElementPayload } from "../../../packages/preview-runtime/src/protocol";

export interface ElementSelectionContext {
  selector: string;
  selectors?: string[];
  tag: string;
  styles: Record<string, string>;
  text?: string;
}

export function toSelectionContext(payload: ElementPayload): ElementSelectionContext {
  const ctx: ElementSelectionContext = {
    selector: payload.selector,
    selectors: payload.selectors,
    tag: payload.tag,
    styles: payload.styles,
  };
  if (payload.text) ctx.text = payload.text;
  return ctx;
}

export function contextToPrompt(ctx: ElementSelectionContext, instruction: string, op?: ElementOp): string {
  const styles = Object.entries(ctx.styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  const lines = [
    "Design Studio element context (v2)",
    `Element: ${ctx.tag} (${ctx.selector})`,
    ctx.text ? `Text: ${ctx.text}` : null,
    `Styles: ${styles}`,
    op ? `Requested structural change: ${op}` : null,
    `Instruction: ${instruction}`,
    '',
    "Apply the requested change in the project source files.",
    "The element context was also written to .design-studio/handoff.json for your MCP tools (get_selected_element).",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}
