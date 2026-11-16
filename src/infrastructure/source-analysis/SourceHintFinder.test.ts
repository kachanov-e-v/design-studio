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
  it("finds component files by text and semantic class", async () => {
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
    const hints = await findSourceHints(root, payload as never);
    const files = hints.map((h) => h.file);
    expect(files).toContain("app/login/page.tsx");
    expect(files).not.toContain("node_modules/pkg/index.js");
    expect(files).not.toContain(".next/cache.js");
    expect(files.some((f) => f.startsWith("styles/"))).toBe(true);
  });

  it("ranks component code above css and skips when nothing matches", async () => {
    const root = makeProject({
      "a/LoginForm.tsx": 'const Email = () => <input placeholder="Email" />;',
      "b/README.md": "Email docs",
    });
    const hints = await findSourceHints(root, payload as never);
    expect(hints[0].file).toBe("a/LoginForm.tsx");

    const empty = makeProject({ "app/x.tsx": "export default 1;\n" });
    expect(await findSourceHints(empty, payload as never)).toEqual([]);
  });
});

describe("contextToPrompt", () => {
  it("includes classes, framework hint, rules and source hints", async () => {
    const ctx = toSelectionContext(payload as never, [
      { file: "app/login/page.tsx", line: 5, snippet: '<div className="email-field px-4 bg-slate-900">Email</div>', token: 'text word "Email"' },
    ]);
    const prompt = contextToPrompt(ctx, "Сделай border 1px этому элементу.");
    expect(prompt).toContain("div.email-field.px-4.bg-slate-900");
    expect(prompt).toContain("Tailwind CSS обнаружен");
    expect(prompt).toContain(".email-field");
    expect(prompt).toContain("_next/static/css/app.css");
    expect(prompt).toContain("app/login/page.tsx:5");
    expect(prompt).toContain("Пожелание пользователя: Сделай border 1px этому элементу.");
  });

  it("adds attributes, edit lines for attribute changes", async () => {
    const ctx = toSelectionContext({ ...payload, attributes: { placeholder: "Email", title: "Поле почты" } } as never, []);
    const prompt = contextToPrompt(ctx, "");
    expect(prompt).toContain('Атрибуты: placeholder="Email", title="Поле почты"');
    const editsPrompt = contextToPrompt(
      ctx,
      "",
      [{ kind: "attribute", selector: payload.selector, property: "placeholder", before: "Email", after: "Ваш e-mail" }]
    );
    expect(editsPrompt).toContain("Атрибут placeholder");
    expect(editsPrompt).toContain('"Email" → "Ваш e-mail"');
  });

  it("adds Component and Owner chain lines from components", async () => {
    const ctx = toSelectionContext({
      ...payload,
      component: [
        { name: "EmailField", file: "src/components/EmailField.tsx", line: 42 },
        { name: "LoginForm" },
        { name: "LoginPage" },
      ],
    } as never, []);
    const prompt = contextToPrompt(ctx, "Сделай border 1px этому элементу.");
    expect(prompt).toContain("Компонент React: EmailField — src/components/EmailField.tsx:42");
    expect(prompt).toContain("Цепочка компонентов: EmailField > LoginForm > LoginPage");
  });

  it("omits optional sections when data is missing", async () => {
    const ctx = toSelectionContext({ selector: "p", tag: "p", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {} } as never, []);
    const prompt = contextToPrompt(ctx, "make it red");
    expect(prompt).toContain("Выбранный элемент: p (p)");
    expect(prompt).not.toContain("Tailwind CSS обнаружен");
    expect(prompt).not.toContain("Возможные исходные файлы");
  });
});

// EXT-01: the scan must obey the shared read budget. Files are read in
// deterministic order under a total-bytes cap; once the cap is spent, new
// files are not read, but hints in the files already read are still found.
describe("findSourceHints read budget (EXT-01)", () => {
  const budgetPayload = {
    selector: "div",
    tag: "div",
    rect: { top: 0, left: 0, width: 10, height: 10 },
    styles: {},
    text: "alpha",
  };

  it("stops reading new files once the budget is spent and keeps found hints", async () => {
    const root = makeProject({
      "aaa/first.tsx": "// alpha marker in the first file\nexport const a = 1;\n",
      "mmm/middle.tsx": "// alpha marker in the middle file\nexport const m = 2;\n",
      "zzz/last.tsx": "// alpha marker in the last file\nexport const z = 3;\n",
    });
    // Readdir + LIFO directory walk gives zzz/last.tsx as the first candidate;
    // with a 10-byte budget only that single file is read.
    const hints = await findSourceHints(root, budgetPayload as never, { maxTotalBytes: 10 });
    expect(hints.map((h) => h.file)).toEqual(["zzz/last.tsx"]);
    expect(hints[0].snippet).toContain("alpha");
  });

  it("reads everything when the contents fit the budget", async () => {
    const root = makeProject({
      "aaa/first.tsx": "// alpha marker in the first file\nexport const a = 1;\n",
      "mmm/middle.tsx": "// alpha marker in the middle file\nexport const m = 2;\n",
      "zzz/last.tsx": "// alpha marker in the last file\nexport const z = 3;\n",
    });
    const hints = await findSourceHints(root, budgetPayload as never, { maxTotalBytes: 32 * 1024 * 1024 });
    expect(hints.map((h) => h.file)).toEqual(["aaa/first.tsx", "mmm/middle.tsx", "zzz/last.tsx"]);
  });
});
