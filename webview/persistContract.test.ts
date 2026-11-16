import { describe, it, expect } from "vitest";
import type { SourceRule } from "./types";
import { buildStylePersistMessage, ackPendingStyles, type PendingStyleEdit } from "./persistContract";

describe("style:persist webview -> extension contract", () => {
  it("names the runtime rules field sourceRules as the extension handler expects", () => {
    const rules: SourceRule[] = [
      { href: "http://localhost:3000/_next/static/css/app.css", selectorText: ".Button_btn__x1y2" },
    ];
    const message = buildStylePersistMessage({
      selector: ".Button_btn__x1y2",
      selectors: [".Button_btn__x1y2", ".Button_btn__x1y2:hover"],
      property: "color",
      value: "tomato",
      sourceRules: rules,
    });
    expect(message.type).toBe("style:persist");
    expect(message.selector).toBe(".Button_btn__x1y2");
    expect(message.property).toBe("color");
    expect(message.value).toBe("tomato");
    // Regression A1: the extension reads msg.sourceRules, never msg.rules.
    expect(message.sourceRules).toEqual(rules);
    expect((message as unknown as Record<string, unknown>).rules).toBeUndefined();
  });

  it("keeps the message minimal when no runtime rules exist", () => {
    const message = buildStylePersistMessage({ selector: ".x", property: "margin", value: "4px" });
    expect(message.sourceRules).toBeUndefined();
    expect(message.selectors).toBeUndefined();
  });
});

// P0-4: per-edit acknowledgement — an acknowledged edit leaves the queue,
// failed and unconfirmed edits stay pending.
describe("pendingStyles queue acknowledgement", () => {
  const queue: PendingStyleEdit[] = [
    { requestId: "r1", selector: ".a", property: "color", value: "v1" },
    { requestId: "r2", selector: ".b", property: "color", value: "v2" },
    { requestId: "r3", selector: ".c", property: "color", value: "v3" },
  ];

  it("removes only the acknowledged edit", () => {
    expect(ackPendingStyles(queue, { requestId: "r2", success: true })).toEqual([
      expect.objectContaining({ requestId: "r1" }),
      expect.objectContaining({ requestId: "r3" }),
    ]);
  });

  it("keeps the whole queue when an edit fails", () => {
    expect(ackPendingStyles(queue, { requestId: "r2", success: false })).toHaveLength(3);
  });

  it("never clears unconfirmed edits on a legacy success without requestId", () => {
    // Legacy message without requestId must not wipe pending edits.
    expect(ackPendingStyles(queue, { success: true })).toHaveLength(3);
  });

  it("carries the requestId through the persist message", () => {
    const message = buildStylePersistMessage({ requestId: "r7", selector: ".x", property: "color", value: "v" });
    expect(message.requestId).toBe("r7");
  });
});
