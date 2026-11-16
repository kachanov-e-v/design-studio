import { describe, it, expect } from "vitest";
import type { SourceRule } from "./types";
import { buildStylePersistMessage } from "./persistContract";

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
