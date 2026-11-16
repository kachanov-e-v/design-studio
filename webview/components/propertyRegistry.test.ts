import { describe, it, expect } from "vitest";
import { EDITABLE_ATTRIBUTES, STYLE_PROPS } from "../../packages/preview-runtime/src/protocol";
import {
  PROPERTY_DEFINITIONS,
  PROPERTY_GROUP_LABEL_KEYS,
  attributeDefinitionsForTag,
  cssColorToHex,
  parseUnitValue,
} from "./propertyRegistry";

describe("propertyRegistry", () => {
  it("has unique CSS keys and valid groups", () => {
    const keys = new Set(PROPERTY_DEFINITIONS.map((def) => def.key));
    expect(keys.size).toBe(PROPERTY_DEFINITIONS.length);
    for (const def of PROPERTY_DEFINITIONS) {
      expect(def.group in PROPERTY_GROUP_LABEL_KEYS).toBe(true);
      if (def.editor === "select") {
        expect(def.options?.length ?? 0).toBeGreaterThan(0);
      }
      if (def.editor === "unit") {
        expect(def.units?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("parses unit values and rejects unknown units and compound values", () => {
    expect(parseUnitValue("16px", ["px", "rem"])).toEqual({ number: 16, unit: "px" });
    expect(parseUnitValue("-.5rem", ["px", "rem"])).toEqual({ number: -0.5, unit: "rem" });
    expect(parseUnitValue("10", ["px", "rem"])).toEqual({ number: 10, unit: "" });
    expect(parseUnitValue("auto", ["px", "rem"])).toBeNull();
    expect(parseUnitValue("calc(1px + 2px)", ["px", "rem"])).toBeNull();
    expect(parseUnitValue("2ch", ["px", "rem"])).toBeNull();
  });

  it("converts CSS colors to hex for the color picker", () => {
    expect(cssColorToHex("#f00")).toBe("#ff0000");
    expect(cssColorToHex("#ff0000")).toBe("#ff0000");
    expect(cssColorToHex("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(cssColorToHex("rgba(0, 0, 255, 0.5)")).toBe("#0000ff");
    expect(cssColorToHex("var(--brand)")).toBeNull();
    expect(cssColorToHex("transparent")).toBeNull();
  });

  it("returns tag-relevant attributes, deduplicated and typed", () => {
    const input = attributeDefinitionsForTag("input");
    const names = input.map((def) => def.name);
    expect(names.filter((name) => name === "type").length).toBe(1);
    expect(names).toContain("placeholder");
    expect(names).toContain("checked");
    expect(names).not.toContain("href");
    const inputType = input.find((def) => def.name === "type");
    expect(inputType?.options?.length).toBeGreaterThan(5);

    const anchor = attributeDefinitionsForTag("a");
    expect(anchor.map((def) => def.name)).toEqual(expect.arrayContaining(["href", "target", "rel"]));
    expect(anchor.map((def) => def.name)).not.toContain("placeholder");

    const div = attributeDefinitionsForTag("div");
    expect(div.map((def) => def.name)).toEqual(expect.arrayContaining(["id", "title", "role", "aria-label"]));
    expect(div.map((def) => def.name)).not.toContain("value");
  });

  it("keeps every attribute definition inside the protocol whitelist", () => {
    const whitelist = new Set<string>(EDITABLE_ATTRIBUTES);
    expect(whitelist).toContain("placeholder");
    for (const def of attributeDefinitionsForTag("input")) expect(whitelist.has(def.name)).toBe(true);
    for (const def of attributeDefinitionsForTag("a")) expect(whitelist.has(def.name)).toBe(true);
    for (const def of attributeDefinitionsForTag("video")) expect(whitelist.has(def.name)).toBe(true);
    for (const def of attributeDefinitionsForTag("form")) expect(whitelist.has(def.name)).toBe(true);
  });

  // P2-2: an editor without a matching STYLE_PROPS entry silently collects
  // nothing — the value is never requested from the runtime and the Inspector
  // always shows an empty before-value.
  it("defines every property key inside the protocol STYLE_PROPS list", () => {
    const missing = PROPERTY_DEFINITIONS.filter((def) => !(STYLE_PROPS as readonly string[]).includes(def.key));
    expect(missing.map((def) => def.key)).toEqual([]);
  });
});
