import type { SourceRule } from "./types";

/** Edit queued in the webview, ready to be persisted to project sources. */
export interface StylePersistEdit {
  selector: string;
  selectors?: string[];
  property: string;
  value: string;
  /** Matched stylesheet rules reported by the preview runtime (dev servers). */
  sourceRules?: SourceRule[];
}

export interface StylePersistMessage extends StylePersistEdit {
  type: "style:persist";
}

/**
 * Single source of truth for the webview -> extension `style:persist`
 * payload. The extension handler reads `sourceRules` (see
 * openDesignStudio.ts); keep both sides in sync through this builder.
 */
export function buildStylePersistMessage(edit: StylePersistEdit): StylePersistMessage {
  return {
    type: "style:persist",
    selector: edit.selector,
    selectors: edit.selectors,
    property: edit.property,
    value: edit.value,
    sourceRules: edit.sourceRules,
  };
}
