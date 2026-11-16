// P2-1: protocol-shape types live in @design-studio/preview-runtime/protocol
// and are re-exported here so webview code can keep importing from ./types
// without drifting from the protocol (this file previously copied
// EditableAttribute/ElementPayload/ElementOp/SourceRule by hand).
export type {
  EditableAttribute,
  ElementOp,
  ElementPayload,
  SourceRule,
} from "@design-studio/preview-runtime/protocol";

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
  language?: "ru" | "en";
}
