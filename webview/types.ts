export interface SourceRule {
  href: string;
  selectorText: string;
  cssText?: string;
}

export interface ElementPayload {
  selector: string;
  selectors?: string[];
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
  text?: string;
  rules?: SourceRule[];
}

export type ElementOp = "set-text" | "delete" | "duplicate" | "move-up" | "move-down";

export type DevServerKind = "vite" | "next" | "astro" | "webpack" | "static-http" | "unknown";

export interface DevServerSuggestion {
  url: string;
  script: string;
  running: boolean;
  kind: DevServerKind;
  /** true: content matches a workspace entry; false: proved foreign; null: not checked. */
  matchesProject: boolean | null;
}

export interface PreviewStateMessage {
  url: string;
  status: string;
  projectRoot?: string | null;
  projectEntry?: string;
  projectEntries?: string[];
  devServer?: string;
  devServerSuggestions?: DevServerSuggestion[];
  pendingChanges?: number;
}
