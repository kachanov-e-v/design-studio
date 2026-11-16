import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import {
  CssSourceResolver,
  cssModulesClassParts,
  decodeSourceMapMappings,
  extractSelectorAt,
  originalPositionFor,
} from "./CssSourceResolver";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlqEncode(value: number): string {
  let encoded = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = encoded & 31;
    encoded >>>= 5;
    if (encoded > 0) digit |= 32;
    out += B64[digit];
  } while (encoded > 0);
  return out;
}

function encodeSegments(lines: number[][][]): string {
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  return lines
    .map((lineSegments) => {
      let genCol = 0;
      return lineSegments
        .map((seg) => {
          let out = vlqEncode(seg[0] - genCol);
          genCol = seg[0];
          if (seg.length === 4) {
            out += vlqEncode(seg[1] - srcIdx) + vlqEncode(seg[2] - origLine) + vlqEncode(seg[3] - origCol);
            srcIdx = seg[1];
            origLine = seg[2];
            origCol = seg[3];
          }
          return out;
        })
        .join(",");
    })
    .join(";");
}

const ORIGINAL_CSS = ".title {\n  color: red;\n}\n.card:hover {\n  color: blue;\n}\n";
const TRANSFORMED_CSS = ".Home_title__AbC { color: red; }\n.Home_card__Qq1:hover { color: blue; }\n";

function mapJson(mappings: string, sources: string[], withContent = true): string {
  return JSON.stringify({
    version: 3,
    sources,
    sourcesContent: withContent ? sources.map(() => ORIGINAL_CSS) : sources.map(() => null),
    names: [],
    mappings,
  });
}

describe("decodeSourceMapMappings / originalPositionFor", () => {
  it("decodes absolute positions from delta encoding", () => {
    const lines = decodeSourceMapMappings("AAAA;AAGA");
    expect(lines[0]).toEqual([[0, 0, 0, 0]]);
    expect(lines[1]).toEqual([[0, 0, 3, 0]]);
    expect(originalPositionFor(lines, 1, 0)).toEqual({ sourceIndex: 0, origLine: 3, origCol: 0 });
  });

  it("picks the last segment at or before the column and skips 1-length segments", () => {
    const lines = decodeSourceMapMappings(`AAAA,${vlqEncode(8)},${vlqEncode(0)}${vlqEncode(0)}${vlqEncode(2)}${vlqEncode(4)}`);
    const plain = [[0, 0, 0, 0], [8], [8, 0, 2, 4]] as number[][];
    expect(lines[0]).toEqual(plain);
    expect(originalPositionFor(lines, 0, 7)).toEqual({ sourceIndex: 0, origLine: 0, origCol: 0 });
    expect(originalPositionFor(lines, 0, 9)).toEqual({ sourceIndex: 0, origLine: 2, origCol: 4 });
  });

  it("returns null when the line has no mapped segments", () => {
    const lines = decodeSourceMapMappings("");
    expect(originalPositionFor(lines, 5, 0)).toBe(null);
  });
});

describe("extractSelectorAt", () => {
  it("recovers a plain selector from a mapped rule start", () => {
    expect(extractSelectorAt(ORIGINAL_CSS, 0, 0)).toBe(".title");
  });

  it("joins multi-line selectors", () => {
    expect(extractSelectorAt(".card,\n.card:hover {\n  color: blue;\n}", 1, 0)).toBe(".card, .card:hover");
  });

  it("returns null for positions inside a rule body", () => {
    expect(extractSelectorAt(ORIGINAL_CSS, 1, 2)).toBe(null);
  });
});

describe("cssModulesClassParts", () => {
  it("splits Next.js style class names", () => {
    expect(cssModulesClassParts("Home_title__AbC")).toEqual({ file: "Home", local: "title" });
  });

  it("handles hyphenated locals", () => {
    expect(cssModulesClassParts("Home_card-header__Qq1")).toEqual({ file: "Home", local: "card-header" });
  });

  it("returns null for non-hashed class names", () => {
    expect(cssModulesClassParts("container")).toBe(null);
    expect(cssModulesClassParts("__ds-overlay")).toBe(null);
  });
});

describe("CssSourceResolver", () => {
  let server: http.Server;
  let origin = "";
  const routes = new Map<string, { body: string; type: string }>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const route = routes.get(req.url ?? "/");
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": route.type });
      res.end(route.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const inlineMapCss = (mappings: string): string =>
    `${TRANSFORMED_CSS}/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
      mapJson(mappings, ["webpack://app/./styles/Home.module.css"])
    ).toString("base64")} */\n`;

  it("maps a hashed rule back to its source selector via an inline dev sourcemap", async () => {
    const mappings = `${encodeSegments([[[0, 0, 0, 0]]])};${encodeSegments([[[0, 0, 3, 0]]])}`;
    routes.set("/styles.css", { body: inlineMapCss(mappings), type: "text/css" });
    const resolver = new CssSourceResolver();
    const resolved = await resolver.resolve({ href: `${origin}/styles.css`, selectorText: ".Home_card__Qq1:hover" });
    expect(resolved).toEqual({
      selectors: [".card:hover"],
      sourceFile: "Home.module.css",
      sourcePath: "app/styles/Home.module.css",
      via: "sourcemap",
    });
  });

  it("supports a separate sourcemap file", async () => {
    const mappings = `${encodeSegments([[[0, 0, 0, 0]]])};${encodeSegments([[[0, 0, 3, 0]]])}`;
    routes.set("/ext.css", {
      body: `${TRANSFORMED_CSS}/*# sourceMappingURL=ext.css.map */\n`,
      type: "text/css",
    });
    routes.set("/ext.css.map", {
      body: mapJson(mappings, ["webpack://app/./styles/Home.module.css"]),
      type: "application/json",
    });
    const resolver = new CssSourceResolver();
    const resolved = await resolver.resolve({ href: `${origin}/ext.css`, selectorText: ".Home_title__AbC" });
    expect(resolved?.via).toBe("sourcemap");
    expect(resolved?.selectors).toEqual([".title"]);
  });

  it("falls back to the class-name heuristic without a sourcemap", async () => {
    routes.set("/plain.css", { body: TRANSFORMED_CSS, type: "text/css" });
    const resolver = new CssSourceResolver();
    const resolved = await resolver.resolve({ href: `${origin}/plain.css`, selectorText: ".Home_title__AbC" });
    expect(resolved).toEqual({ selectors: [".title"], sourceFile: "Home.module.css", via: "heuristic" });
  });

  it("returns null when neither sourcemap nor heuristic can map the selector", async () => {
    const mappings = `${encodeSegments([[[0, 0, 0, 0]]])};${encodeSegments([[[0, 0, 3, 0]]])}`;
    routes.set("/global.css", {
      body: `${TRANSFORMED_CSS}/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
        mapJson(mappings, ["webpack://app/./styles/global.css"])
      ).toString("base64")} */\n`,
      type: "text/css",
    });
    const resolver = new CssSourceResolver();
    expect(await resolver.resolve({ href: `${origin}/global.css`, selectorText: ".header" })).toBe(null);
  });

  it("rejects non-localhost stylesheet URLs", async () => {
    const resolver = new CssSourceResolver();
    expect(await resolver.resolve({ href: "https://evil.example/styles.css", selectorText: ".Home_title__AbC" })).toBe(null);
  });

  it("ignores a sourceMappingURL on a non-loopback host (SSRF gate)", async () => {
    routes.set("/gated.css", {
      body: `${TRANSFORMED_CSS}/*# sourceMappingURL=https://evil.example/app.css.map */\n`,
      type: "text/css",
    });
    const resolver = new CssSourceResolver();
    const resolved = await resolver.resolve({ href: `${origin}/gated.css`, selectorText: ".Home_title__AbC" });
    expect(resolved?.via).toBe("heuristic");
  });

  it("does not follow redirects when fetching an external source map", async () => {
    let redirectHits = 0;
    const mini = http.createServer((req, res) => {
      const p = (req.url ?? "/").split("?")[0];
      if (p === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(`${TRANSFORMED_CSS}/*# sourceMappingURL=${`${miniOrigin}`}/hop.map */\n`);
        return;
      }
      if (p === "/hop.map") {
        redirectHits += 1;
        res.writeHead(302, { Location: `${miniOrigin}/real.map` });
        res.end();
        return;
      }
      if (p === "/real.map") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(mapJson(`${encodeSegments([[[0, 0, 0, 0]]])};${encodeSegments([[[0, 0, 3, 0]]])}`, ["webpack://app/./styles/Home.module.css"]));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => mini.listen(0, "127.0.0.1", r));
    const miniOrigin = `http://127.0.0.1:${(mini.address() as { port: number }).port}`;
    try {
      const resolver = new CssSourceResolver();
      const resolved = await resolver.resolve({ href: `${miniOrigin}/styles.css`, selectorText: ".Home_title__AbC" });
      // The loopback map ref is fetched, but the redirect must not be followed.
      expect(redirectHits).toBe(1);
      expect(resolved?.via).toBe("heuristic");
    } finally {
      mini.closeAllConnections();
      await new Promise<void>((r) => mini.close(() => r()));
    }
  });
});
