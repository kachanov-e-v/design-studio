import { describe, expect, it } from "vitest";
import { applyStructureOp, resolveElement, scanHtmlElements } from "./HtmlStructureEditor";

const PAGE = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <main class="wrap">
    <section class="card" id="first">
      <h1 class="title">Hello</h1>
    </section>
    <section class="card">Second</section>
    <img src="x.png">
    <p class="lead">Tail text</p>
  </main>
</body>
</html>
`;

describe("scanHtmlElements", () => {
  it("builds the element tree with parents, nth and sibling order", () => {
    const els = scanHtmlElements(PAGE);
    const html = els.find((e) => e.tag === "html");
    const body = els.find((e) => e.tag === "body");
    const main = els.find((e) => e.tag === "main");
    const img = els.find((e) => e.tag === "img");
    expect(html && body && main && img).toBeTruthy();
    expect(main?.parentIndex).toBe(body?.index);
    expect(img?.parentIndex).toBe(main?.index);
    expect(img?.unclosed).toBe(false);
    expect(img?.end).toBe(img?.openEnd);
    const sections = els.filter((e) => e.tag === "section");
    expect(sections.map((s) => s.nth)).toEqual([1, 2]);
    expect(sections.map((s) => s.siblingIndex)).toEqual([1, 2]);
  });

  it("does not parse tags inside script content", () => {
    const els = scanHtmlElements(`<body><script>if (a < b) { let s = "<div>"; }</script><main>x</main></body>`);
    expect(els.filter((e) => e.tag === "div")).toHaveLength(0);
    expect(els.find((e) => e.tag === "script")?.end).toBeGreaterThan(els.find((e) => e.tag === "script")!.openEnd);
  });
});

describe("resolveElement", () => {
  const els = scanHtmlElements(PAGE);

  it("resolves ids and class-subset candidates uniquely", () => {
    expect(resolveElement(els, ["#first", ".card", "main > section:nth-of-type(1)"])?.id).toBe("first");
  });

  it("resolves via the structural path when the short selector is ambiguous", () => {
    expect(resolveElement(els, [".card", 'main > section.card:nth-of-type(2)'])?.nth).toBe(2);
  });

  it("returns null when nothing matches or match is ambiguous", () => {
    expect(resolveElement(els, ["#missing"])).toBeNull();
    expect(resolveElement(els, [".card"])).toBeNull();
    expect(resolveElement(els, [])).toBeNull();
  });

  it("unescapes CSS-escaped class candidates", () => {
    const doc = `<body><div class="md:px-4">a</div></body>`;
    const els2 = scanHtmlElements(doc);
    expect(resolveElement(els2, [".md\\:px-4"])?.tag).toBe("div");
  });
});

describe("applyStructureOp", () => {
  it("deletes the element along with its line indent", () => {
    const out = applyStructureOp(PAGE, "delete", ["#missing", ".card", 'main > section.card:nth-of-type(2)']);
    expect(out).not.toContain("Second");
    expect(out).toContain("id=\"first\"");
    expect(out).toContain("<img");
  });

  it("duplicates a block preserving indentation", () => {
    const out = applyStructureOp(PAGE, "duplicate", ['#first', ".card", 'main > section:nth-of-type(1)'])!;
    expect(out).not.toBeNull();
    const matches = out.match(/id="first"/g);
    expect(matches).toHaveLength(2);
    const lines = out.split("\n").filter((l) => l.includes('id="first"'));
    expect(lines[0].trim()).toBe(lines[1].trim());
  });

  it("moves an element up and down among siblings", () => {
    const up = applyStructureOp(PAGE, "move-up", ['p.lead', 'main > p:nth-of-type(1)'])!;
    expect(up).not.toBeNull();
    const imgIdx = up.indexOf("<img");
    const leadIdx = up.indexOf('class="lead"');
    expect(leadIdx).toBeLessThan(imgIdx);

    const down = applyStructureOp(up, "move-down", ['p.lead', 'main > p:nth-of-type(1)'])!;
    const imgIdx2 = down.indexOf("<img");
    const leadIdx2 = down.indexOf('class="lead"');
    expect(leadIdx2).toBeGreaterThan(imgIdx2);
  });

  it("returns null when there is no sibling to swap with", () => {
    const doc = `<body><main><p>only</p></main></body>`;
    expect(applyStructureOp(doc, "move-up", ["p"])).toBeNull();
    expect(applyStructureOp(doc, "move-down", ["p"])).toBeNull();
  });

  it("returns null when the element cannot be resolved", () => {
    expect(applyStructureOp(PAGE, "delete", ["#nope"])).toBeNull();
  });
});
