export interface ElementPayload {
  selector: string;
  tag: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<string, string>;
}