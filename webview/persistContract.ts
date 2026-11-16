import type { SourceRule } from "./types";

/** Edit queued in the webview, ready to be persisted to project sources. */
export interface StylePersistEdit {
  requestId?: string;
  selector: string;
  selectors?: string[];
  property: string;
  value: string;
  /** Matched stylesheet rules reported by the preview runtime (dev servers). */
  sourceRules?: SourceRule[];
}

export interface StylePersistMessage extends StylePersistEdit {
  type: "style:persist";
  /** Echoed back in persist:result so only applied edits leave the queue. */
  requestId?: string;
}

/** Edit queued in the webview with its correlation id. */
export interface PendingStyleEdit extends StylePersistEdit {
  requestId: string;
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
    ...(edit.requestId ? { requestId: edit.requestId } : {}),
  };
}

/**
 * P0-4: apply a persist:result to the pending queue. A successfully applied
 * edit leaves the queue; failed edits stay (the user can retry Save), and a
 * legacy success without requestId keeps the queue untouched — wiping it
 * silently discarded unacknowledged edits.
 */
export function ackPendingStyles(
  pending: PendingStyleEdit[],
  result: { success?: boolean; requestId?: string }
): PendingStyleEdit[] {
  if (!result.success) return pending;
  if (typeof result.requestId !== "string" || result.requestId.length === 0) return pending;
  return pending.filter((edit) => edit.requestId !== result.requestId);
}
