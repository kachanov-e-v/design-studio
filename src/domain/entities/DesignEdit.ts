export type DesignEditKind = "style" | "text" | "classes" | "structure";

export interface DesignEdit {
  kind: DesignEditKind;
  selector: string;
  property?: string;
  before?: string;
  after?: string;
  operation?: string;
  component?: { name?: string; file?: string; line?: number };
}
