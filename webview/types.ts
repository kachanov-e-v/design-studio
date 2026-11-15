export interface ElementPayload {
  selector: string;
  selectors?: string[];
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
  text?: string;
}

export type ElementOp = "set-text" | "delete" | "duplicate" | "move-up" | "move-down";

export interface PreviewStateMessage {
  url: string;
  status: string;
  projectRoot?: string | null;
  projectEntry?: string;
  projectEntries?: string[];
  devServer?: string;
  pendingChanges?: number;
}
