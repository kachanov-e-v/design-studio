import { isLocalhostUrl } from "../../shared/url";
import { findCssRules } from "./cssText";

export interface SourceRule {
  href: string;
  selectorText: string;
}

export interface ResolvedSource {
  /** Original (unhashed) selectors, e.g. [".title:hover"] */
  selectors: string[];
  /** Workspace-relative file name to edit, e.g. "Home.module.css" */
  sourceFile: string;
  /** Relative source path from the source map, e.g. "src/app/Home.module.css".
   * Absent for the heuristic (name-pattern) mapping. */
  sourcePath?: string;
  /** How the mapping was made, for diagnostics and journal notes. */
  via: "sourcemap" | "heuristic";
}

interface CssSourceMap {
  sources: string[];
  sourcesContent: (string | null)[];
  mappings: string;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(input: string, index: number): { value: number; index: number } {
  let result = 0;
  let shift = 0;
  let cursor = index;
  for (;;) {
    const digit = B64_ALPHABET.indexOf(input[cursor] ?? "");
    if (digit < 0) throw new Error("invalid VLQ character");
    // A continuation longer than 6 digits overflows a 32-bit field — corrupt mappings.
    if (shift > 30) throw new Error("VLQ sequence too long");
    result += (digit & 31) << shift;
    shift += 5;
    cursor += 1;
    if ((digit & 32) === 0) break;
  }
  const negative = (result & 1) === 1;
  result >>= 1;
  return { value: negative ? -result : result, index: cursor };
}

const SEGMENT_LENGTHS_OK = 4;

/**
 * Decode a source map "mappings" string into segments per generated line:
 * [generatedColumn, sourceIndex, originalLine, originalColumn]
 */
export function decodeSourceMapMappings(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  for (const lineStr of mappings.split(";")) {
    let genCol = 0;
    const segments: number[][] = [];
    for (const seg of lineStr.split(",")) {
      if (!seg) continue;
      let cursor = 0;
      const values: number[] = [];
      while (cursor < seg.length) {
        const decoded = decodeVlq(seg, cursor);
        values.push(decoded.value);
        cursor = decoded.index;
      }
      genCol += values[0];
      if (values.length < SEGMENT_LENGTHS_OK) {
        segments.push([genCol]);
        continue;
      }
      srcIdx += values[1];
      origLine += values[2];
      origCol += values[3];
      segments.push([genCol, srcIdx, origLine, origCol]);
    }
    lines.push(segments);
  }
  return lines;
}

/** Last source-mapped segment at or before the given generated position. */
export function originalPositionFor(
  segmentsByLine: number[][][],
  genLine: number,
  genCol: number
): { sourceIndex: number; origLine: number; origCol: number } | null {
  const segments = segmentsByLine[genLine];
  if (!segments) return null;
  let best: number[] | null = null;
  for (const seg of segments) {
    if (seg.length < SEGMENT_LENGTHS_OK) continue;
    if (seg[0] <= genCol) best = seg;
  }
  if (!best) return null;
  return { sourceIndex: best[1], origLine: best[2], origCol: best[3] };
}

/**
 * Recover the original CSS selector text for a rule whose source position
 * (line, col) is known: forward to the opening brace, back to the previous
 * rule terminator. Returns null when the position is not inside a selector.
 */
export function extractSelectorAt(content: string, line: number, col: number): string | null {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return null;
  let endLine = -1;
  let endAnchor = -1;
  let landedInBody = false;
  for (let i = line; i < Math.min(lines.length, line + 20); i++) {
    const from = i === line ? Math.max(0, Math.min(col, lines[i].length)) : 0;
    let brace = -1;
    for (let j = from; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (ch === "}" || ch === ";") {
        landedInBody = true; // position ended up inside a rule body, not a selector
        break;
      }
      if (ch === "{") {
        brace = j;
        break;
      }
    }
    if (brace >= 0) {
      endLine = i;
      endAnchor = brace;
      break;
    }
    if (landedInBody) return null;
  }
  if (endLine < 0) return null;

  let startLine = 0;
  let startCol = 0;
  for (let i = endLine; i >= 0; i--) {
    const upper = i === endLine ? endAnchor : lines[i].length;
    const boundary = Math.max(lines[i].lastIndexOf("}", upper - 1), lines[i].lastIndexOf(";", upper - 1));
    if (boundary >= 0) {
      startLine = i;
      startCol = boundary + 1;
      break;
    }
  }
  const parts: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const from = i === startLine ? startCol : 0;
    const to = i === endLine ? endAnchor : lines[i].length;
    parts.push(lines[i].slice(from, to));
  }
  const selector = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!selector || /[;{}]/.test(selector)) return null;
  return selector;
}

/** Split a "Home_title__Xk3m" style class back into { file: "Home", local: "title" }. */
export function cssModulesClassParts(
  name: string
): { file: string; local: string } | null {
  const cut = name.indexOf("__");
  if (cut <= 0) return null;
  const head = name.slice(0, cut);
  if (!/^[\w-]+$/.test(head)) return null;
  const sep = head.indexOf("_");
  if (sep <= 0) return { file: "", local: head };
  return { file: head.slice(0, sep), local: head.slice(sep + 1) };
}

function unhashSelector(selector: string): { file: string; local: string } | null {
  const classes = selector.match(/\.([A-Za-z_][\w-]*)/g);
  if (!classes || classes.length === 0) return null;
  for (const cls of classes) {
    const parts = cssModulesClassParts(cls.slice(1));
    if (parts && parts.file) return parts;
  }
  return null;
}

const SOURCE_MAP_COMMENT = /\/\*#\s*sourceMappingURL=([^\s*]+)\s*\*\//;

/** Resolve the sourceMappingURL comment into inline JSON or a fetchable URL. */
function parseSourceMapRef(css: string, cssUrl: string): { inline?: string; url?: string } | null {
  const matches = css.match(new RegExp(SOURCE_MAP_COMMENT.source, "g"));
  const last = matches?.[matches.length - 1];
  if (!last) return null;
  const url = SOURCE_MAP_COMMENT.exec(last)?.[1];
  if (!url) return null;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) return null;
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    try {
      const json = /;base64/i.test(meta)
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return { inline: json };
    } catch {
      return null;
    }
  }
  try {
    return { url: new URL(url, cssUrl).toString() };
  } catch {
    return null;
  }
}

function basenameFromSource(source: string): string | null {
  const cleaned = relativeSourcePath(source) ?? source;
  const cut = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  const name = cut >= 0 ? cleaned.slice(cut + 1) : cleaned;
  return /^[\w.-]+\.module\.css$/i.test(name) ? name : null;
}

/** Normalized slash-separated relative path of a raw source-map source entry. */
function relativeSourcePath(source: string): string | null {
  let cleaned = source;
  try {
    cleaned = decodeURIComponent(source);
  } catch {
    // keep raw
  }
  cleaned = cleaned.replace(/^webpack:\/\//, "");
  const query = cleaned.indexOf("?");
  if (query >= 0) cleaned = cleaned.slice(0, query);
  const cleanedPath = cleaned
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  return /\.module\.css$/i.test(cleanedPath) ? cleanedPath : null;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Same SSRF policy as the preview host: no redirects, loopback-only
    // callers checked upstream of this helper.
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CACHE_TTL_MS = 5000;

interface CacheEntry {
  fetchedAt: number;
  css: string;
  map: CssSourceMap | null;
}

/**
 * Maps hashed CSS Modules selectors from a dev server back to the original
 * `*.module.css` sources via dev source maps (falls back to the
 * `<file>_<local>__<hash>` name pattern). Only localhost stylesheet URLs are
 * accepted — the runtime only reports project pages anyway.
 */
export class CssSourceResolver {
  private cache = new Map<string, CacheEntry>();

  /** Test seam. */
  protected async fetchCss(url: string): Promise<string | null> {
    return fetchText(url, 2500);
  }

  private async loadSheet(rule: SourceRule): Promise<CacheEntry | null> {
    const cached = this.cache.get(rule.href);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
    if (!isLocalhostUrl(rule.href)) return null;
    const css = await this.fetchCss(rule.href);
    if (css === null) return null;
    const entry: CacheEntry = { fetchedAt: Date.now(), css, map: null };
    const mapRef = parseSourceMapRef(css, rule.href);
    let raw = mapRef?.inline ?? null;
    // sourceMappingURL may point anywhere: only loopback URLs pass the gate.
    if (raw === null && mapRef?.url && isLocalhostUrl(mapRef.url)) {
      raw = await fetchText(mapRef.url, 2500);
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as CssSourceMap;
        if (Array.isArray(parsed.sources) && typeof parsed.mappings === "string") {
          entry.map = { sources: parsed.sources, sourcesContent: parsed.sourcesContent ?? [], mappings: parsed.mappings };
        }
      } catch {
        // keep entry without map
      }
    }
    this.cache.set(rule.href, entry);
    return entry;
  }

  async resolve(rule: SourceRule): Promise<ResolvedSource | null> {
    if (!isLocalhostUrl(rule.href)) return null;
    const entry = await this.loadSheet(rule);
    if (!entry) return null;

    if (entry.map) {
      const mapped = this.resolveViaSourceMap(rule, entry);
      if (mapped) return mapped;
    }
    const heuristic = cssModulesClassPartsHeuristic(rule.selectorText);
    return heuristic;
  }

  private resolveViaSourceMap(rule: SourceRule, entry: CacheEntry): ResolvedSource | null {
    if (!entry.map) return null;
    const positions = findCssRules(entry.css, rule.selectorText);
    if (positions.length === 0) return null;
    const ruleStart = positions[0].start;

    const lines = entry.css.split("\n");
    let line = 0;
    let col = ruleStart;
    for (const textLine of lines) {
      if (col <= textLine.length) break;
      col -= textLine.length + 1;
      line += 1;
    }
    if (line >= lines.length) return null;

    const segments = decodeSourceMapMappings(entry.map.mappings);
    const position = originalPositionFor(segments, line, col);
    if (!position) return null;
    const source = entry.map.sources[position.sourceIndex];
    if (typeof source !== "string") return null;
    const sourceFile = basenameFromSource(source);
    if (!sourceFile) return null;
    const content = entry.map.sourcesContent[position.sourceIndex];
    if (content === null || content === undefined) return null;
    const selector = extractSelectorAt(content, position.origLine, position.origCol);
    if (!selector) return null;
    return { selectors: [selector], sourceFile, sourcePath: relativeSourcePath(source) ?? undefined, via: "sourcemap" };
  }
}

function cssModulesClassPartsHeuristic(selectorText: string): ResolvedSource | null {
  const unhashed = unhashSelector(selectorText);
  if (!unhashed) return null;
  return { selectors: [`.${unhashed.local}`], sourceFile: `${unhashed.file}.module.css`, via: "heuristic" };
}
