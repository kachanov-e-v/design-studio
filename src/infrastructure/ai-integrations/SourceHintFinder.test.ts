import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findSourceHints } from "./SourceHintFinder";
import { contextToPrompt, toSelectionContext } from "../../domain/entities/DesignElementContext";

const tempDirs: string[] = [];

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-hints-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const payload = {
  selector: "div:nth-of-type(2) > form > div:nth-of-type(1)",
  tag: "div",
  rect: { top: 0, left: 0, width: 352, height: 48 },
  styles: { color: "rgb(241, 245, 249)" },
  classes: ["email-field", "px-4", "bg-slate-900"],
  text: "Email",
  tailwind: true,
  rules: [{ href: "http://127.0.0.1:9321/proxy/http://localhost:3000/_next/static/css/app.css", selectorText: ".email-field" }],
};

describe("findSourceHints", () => {
  it("finds component files by text and semantic class", () => {
    const root = makeProject({
      "app/login/page.tsx": `export default function Login() {
  return (
    <form>
      <div className="email-field px-4 bg-slate-900">Email</div>
    </form>
  );
}
`,
      "node_modules/pkg/index.js": 'console.log("Email");',
      ".next/cache.js": "Email",
      "styles/globals.css": ".email-field { color: red; }\n",
    });
    const hints = findSourceHints(root, payload as never);
    const files = hints.map((h) => h.file);
    expect(files).toContain("app/login/page.tsx");
    expect(files).not.toContain("node_modules/pkg/index.js");
    expect(files).not.toContain(".next/cache.js");
    expect(files.some((f) => f.startsWith("styles/"))).toBe(true);
  });

  it("ranks component code above css and skips when nothing matches", () => {
    const root = makeProject({
      "a/LoginForm.tsx": 'const Email = () => <input placeholder="Email" />;',
      "b/README.md": "Email docs",
    });
    const hints = findSourceHints(root, payload as never);
    expect(hints[0].file).toBe("a/LoginForm.tsx");

    const empty = makeProject({ "app/x.tsx": "export default 1;\n" });
    expect(findSourceHints(empty, payload as never)).toEqual([]);
  });
});

describe("contextToPrompt v3", () => {
  it("includes classes, framework hint, rules and source hints", () => {
    const ctx = toSelectionContext(payload as never, [
      { file: "app/login/page.tsx", line: 5, snippet: '<div className="email-field px-4 bg-slate-900">Email</div>', token: 'text word "Email"' },
    ]);
    const prompt = contextToPrompt(ctx, "Сделай border 1px этому элементу.");
    expect(prompt).toContain("(v3)");
    expect(prompt).toContain("div.email-field.px-4.bg-slate-900");
    expect(prompt).toContain("Tailwind CSS detected");
    expect(prompt).toContain(".email-field");
    expect(prompt).toContain("_next/static/css/app.css");
    expect(prompt).toContain("app/login/page.tsx:5");
    expect(prompt).toContain("get_selected_element");
  });

  it("omits optional sections when data is missing", () => {
    const ctx = toSelectionContext({ selector: "p", tag: "p", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {} } as never, []);
    const prompt = contextToPrompt(ctx, "make it red");
    expect(prompt).toContain("Element: p (p)");
    expect(prompt).not.toContain("Tailwind CSS detected");
    expect(prompt).not.toContain("Possible source locations");
  });
});
