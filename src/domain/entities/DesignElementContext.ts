export interface DesignElementContext {
  version: "1";
  selector: string;
  tag: string;
  styles: Record<string, string>;
  instruction: string;
}