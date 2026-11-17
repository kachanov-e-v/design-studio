export type DesignEditKind = "style" | "text" | "classes" | "attribute" | "structure" | "comment";

export interface DesignEdit {
  kind: DesignEditKind;
  selector: string;
  property?: string;
  before?: string;
  after?: string;
  operation?: string;
  component?: { name?: string; file?: string; line?: number };
  /** Runtime request id; present on structure edits so they can be undone. */
  requestId?: string;
}
