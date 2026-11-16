import { describe, expect, it } from "vitest";
import {
  findCssRules,
  findTopLevelDeclarations,
  isValidCssValue,
  normalizeCssSelector,
  splitTopLevelSelectors,
} from "./cssText";

describe("splitTopLevelSelectors edge cases (coverage)", () => {
  it("ignores commas inside quoted strings", () => {
    expect(splitTopLevelSelectors(`a[data-x="1, 2"], b`)).toEqual([`a[data-x="1, 2"]`, "b"]);
  });

  it("ignores commas inside parentheses", () => {
    expect(splitTopLevelSelectors(":is(a, b):hover, div")).toEqual([":is(a, b):hover", "div"]);
  });

  it("only closes a quote-tracking state it opened", () => {
    // A double quote inside a single-quoted region stays literal.
    expect(splitTopLevelSelectors(`q[title='"com,ma"'], r`)).toEqual([`q[title='"com,ma"']`, "r"]);
  });
});

describe("findCssRules edge cases (coverage)", () => {
  it("does not match commented-out selector fragments", () => {
    // The comment stays part of the raw selector text, so a rule whose
    // selector contains a comment is never matched on the fragment alone.
    const css = `.a { color: red; } .b /* { fake */ { color: blue; }`;
    expect(findCssRules(css, ".b")).toEqual([]);
    expect(findCssRules(css, ".a")).toHaveLength(1);
  });

  it("skips braces and commas inside string values", () => {
    const css = `code::after { content: "}"; }`;
    const r = findCssRules(css, "code::after");
    expect(r).toHaveLength(1);
    expect(css.slice(r[0].bodyStart, r[0].bodyEnd)).toContain(`content: "}"`);
  });

  it("handles escaped quotes in string before a brace", () => {
    const css = `x::after { content: "a\\"{}"; }`;
    const r = findCssRules(css, "x::after");
    expect(r).toHaveLength(1);
  });

  it("recurses into at-rules but not into bare at-statements", () => {
    const css = "@media (min-width: 1px) { .m { color: red; } } @charset \"utf-8\"; .z { color: blue; }";
    expect(findCssRules(css, ".m")).toHaveLength(1);
    expect(findCssRules(css, ".z")).toHaveLength(1);
  });

  it("tolerates unterminated blocks and unterminated comments", () => {
    expect(findCssRules(".u { color: red", ".u")).toHaveLength(0);
    expect(findCssRules("/* unterminated { .u { color: red; }", ".u")).toHaveLength(0);
  });

  it("matches any selector from an array of wanted candidates", () => {
    const css = ".one { color: red; } .two { color: blue; }";
    expect(findCssRules(css, [".one", ".two"])).toHaveLength(2);
    expect(findCssRules(css, ["", ".one"])).toHaveLength(1);
  });
});

describe("findTopLevelDeclarations edge cases (coverage)", () => {
  it("skips declarations inside nested blocks", () => {
    const spans = findTopLevelDeclarations("color: red; & .child { color: blue; margin: 0; }");
    expect(spans.map((s) => s.property)).toEqual(["color"]);
  });

  it("skips values inside url() and quoted strings across escapes", () => {
    const body = `background: url(data:image/png,a;b); content: "x;'y;z';" ; color: green;`;
    const spans = findTopLevelDeclarations(body);
    const props = spans.map((s) => s.property);
    expect(props).toEqual(["background", "content", "color"]);
    const background = body.slice(spans[0].start, spans[0].end);
    expect(background).toBe("background: url(data:image/png,a;b);");
  });

  it("does not treat property mentions inside comments as declarations", () => {
    const spans = findTopLevelDeclarations("/* color: red; */ color: green;");
    expect(spans).toHaveLength(1);
    expect(spans[0].property).toBe("color");
  });

  it("consumes an unterminated declaration to end of body", () => {
    const spans = findTopLevelDeclarations("color: red");
    expect(spans).toHaveLength(1);
    expect(spans[0].end).toBe("color: red".length);
  });

  it("ignores unbalanced parentheses and reopening identifiers", () => {
    const spans = findTopLevelDeclarations("a b c: 1; color: red;");
    expect(spans.map((s) => s.property)).toEqual(["c", "color"]);
  });
});

describe("validators and selector normalization (coverage)", () => {
  it("rejects control characters and structural characters in values", () => {
    expect(isValidCssValue("a\nb")).toBe(false);
    expect(isValidCssValue("a}b")).toBe(false);
    expect(isValidCssValue("plain-value")).toBe(true);
  });

  it("normalizes selector whitespace", () => {
    expect(normalizeCssSelector("div    >    span ,   a")).toBe("div > span , a");
  });
});
