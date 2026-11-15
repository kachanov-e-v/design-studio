import type { ElementOp, ElementPayload } from "../../../packages/preview-runtime/src/protocol";

export type DesignChangeKind = "style" | "text" | "structure";

export type DesignChangeStatus = "pending" | "applied-to-source";

export interface DesignChangeDetails {
  property?: string;
  value?: string;
  op?: ElementOp;
  text?: string;
}

export interface DesignChangeRecord {
  id: string;
  ts: string;
  kind: DesignChangeKind;
  selector: string;
  selectors?: string[];
  details: DesignChangeDetails;
  status: DesignChangeStatus;
  file?: string;
  note?: string;
}

export interface ElementHandoff {
  ts: string;
  status: "new" | "accepted";
  element: ElementPayload;
  instruction: string;
}

export function designChangeToPrompt(change: DesignChangeRecord): string {
  if (change.kind === "style" && change.details.property) {
    return `set CSS ${change.details.property} on ${change.selector} to ${change.details.value}`;
  }
  if (change.kind === "text" && change.details.text !== undefined) {
    return `change text of ${change.selector} to: "${change.details.text}"`;
  }
  if (change.kind === "structure" && change.details.op) {
    return `apply structure op ${change.details.op} on ${change.selector}`;
  }
  return `unknown change on ${change.selector}`;
}
