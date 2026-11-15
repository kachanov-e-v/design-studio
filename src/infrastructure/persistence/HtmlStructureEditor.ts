/**
 * Position-based DOM -> source mapping for static HTML projects.
 *
 * The runtime reports a list of CSS selector candidates for the operated
 * element. This module scans the raw HTML source into an element tree (no
 * browser normalization, no dependencies), resolves the element by finding a
 * candidate that matches exactly one element in the source, and rewrites the
 * text for move-up/move-down/duplicate/delete. When the element cannot be
 * resolved unambiguously the caller falls back to the journal/agent path.
 *
 * Everything is pure text-in/text-out and fully testable.
 */

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const RAW_CONTENT_TAGS = new Set(["script", "style", "textarea", "title"]);

export interface ScannedElement {
  index: number;
  tag: string;
  /** Offset of '<' of the open tag. */
  start: number;
  /** Offset after '>' of the open tag. */
  openEnd: number;
  /** Offset after the close tag ('>' inclusive); == openEnd for void/self-closed/unclosed. */
  end: number;
  id?: string;
  classes: string[];
  /** Index into the element list, -1 for root level. */
  parentIndex: number;
  /** 1-based position among same-tag siblings. */
  nth: number;
  /** 1-based position among all element siblings. */
  siblingIndex: number;
  unclosed: boolean;
}

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  nth?: number;
}

/** Scan raw HTML text and return the element tree in document order. */
export function scanHtmlElements(text: string): ScannedElement[] {
  const elements: ScannedElement[] = [];
  const stack: number[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== "<") {
      i++;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const e = text.indexOf("-->", i + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (text.startsWith("<!", i) || text.startsWith("<?", i)) {
      const e = text.indexOf(">", i);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (text[i + 1] === "/") {
      const gt = text.indexOf(">", i);
      if (gt === -1) break;
      const name = text.slice(i + 2, gt).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 0; s--) {
        if (elements[stack[s]].tag === name) {
          for (let k = stack.length - 1; k >= s; k--) {
            elements[stack[k]].end = gt + 1;
          }
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(text.slice(i, i + 64));
    if (!m) {
      i++;
      continue;
    }
    const tag = m[1].toLowerCase();
    let j = i + m[0].length;
    let quote: string | null = null;
    while (j < n) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    if (j >= n) break;
    const openEnd = j + 1;
    let selfClosed = false;
    let k = j - 1;
    while (k > i && (text[k] === " " || text[k] === "\t")) k--;
    if (text[k] === "/") selfClosed = true;

    const attrs = text.slice(i + m[0].length, j);
    const el: ScannedElement = {
      index: elements.length,
      tag,
      start: i,
      openEnd,
      end: openEnd,
      classes: [],
      parentIndex: stack.length > 0 ? stack[stack.length - 1] : -1,
      nth: 1,
      siblingIndex: 1,
      unclosed: false,
    };
    const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const id = idM ? idM[1] ?? idM[2] ?? idM[3] : undefined;
    if (id) el.id = id;
    const classM = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const classValue = classM ? classM[1] ?? classM[2] ?? classM[3] : undefined;
    if (classValue) el.classes = classValue.split(/\s+/).filter(Boolean);
    elements.push(el);

    if (RAW_CONTENT_TAGS.has(tag)) {
      const closeM = new RegExp(`</${tag}\\s*>`, "i").exec(text.slice(openEnd));
      if (closeM) {
        el.end = openEnd + closeM.index + closeM[0].length;
        i = el.end;
      } else {
        el.unclosed = true;
        i = n;
      }
    } else if (VOID_ELEMENTS.has(tag) || selfClosed) {
      i = openEnd;
    } else {
      stack.push(el.index);
      i = openEnd;
    }
  }
  for (const idx of stack) elements[idx].unclosed = true;

  const byParent = new Map<number, ScannedElement[]>();
  for (const el of elements) {
    const group = byParent.get(el.parentIndex);
    if (group) group.push(el);
    else byParent.set(el.parentIndex, [el]);
  }
  for (const group of byParent.values()) {
    group.sort((a, b) => a.start - b.start);
    const tagCounts = new Map<string, number>();
    group.forEach((el, order) => {
      el.siblingIndex = order + 1;
      const count = (tagCounts.get(el.tag) ?? 0) + 1;
      tagCounts.set(el.tag, count);
      el.nth = count;
    });
  }
  return elements;
}

function unescapeCss(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

/** Parse one compound selector part: tag, #id, .classes, :nth-of-type(n). */
function parseCompound(raw: string): Compound | null {
  let s = raw.trim();
  if (!s) return null;
  const nthM = /:nth-of-type\(\s*(\d+)\s*\)/.exec(s);
  const nth = nthM ? Number(nthM[1]) : undefined;
  s = s.replace(/:nth-of-type\(\s*\d+\s*\)/, "");
  s = unescapeCss(s);
  const compound: Compound = { classes: [] };
  const segRe = /([.#])((?:\\.|[^.#\s>+~])+)|^([a-zA-Z][\w-]*)/g;
  let matched = "";
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(s)) !== null) {
    matched += m[0];
    if (m[1] === "#") compound.id = m[2];
    else if (m[1] === ".") {
      const cls = m[2];
      if (compound.classes) compound.classes.push(cls);
    } else {
      compound.tag = m[3].toLowerCase();
    }
  }
  if (matched !== s) return null;
  if (nth !== undefined) compound.nth = nth;
  return compound;
}

function elementMatches(el: ScannedElement, c: Compound): boolean {
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  if (c.classes && !c.classes.every((cls) => el.classes.includes(cls))) return false;
  if (c.nth !== undefined && el.nth !== c.nth && el.tag) return false;
  return true;
}

function childrenByParent(elements: ScannedElement[]): Map<number, ScannedElement[]> {
  const map = new Map<number, ScannedElement[]>();
  for (const el of elements) {
    const group = map.get(el.parentIndex);
    if (group) group.push(el);
    else map.set(el.parentIndex, [el]);
  }
  return map;
}

function matchPath(elements: ScannedElement[], selector: string): ScannedElement[] {
  const parts = selector.split(/\s*>\s*/).map(parseCompound);
  if (parts.length === 0 || parts.some((p) => p === null)) return [];
  const bodies = elements.filter((e) => e.tag === "body");
  if (bodies.length !== 1) return [];
  let current: ScannedElement[] = [bodies[0]];
  const children = childrenByParent(elements);
  for (const part of parts) {
    const next: ScannedElement[] = [];
    for (const parent of current) {
      for (const child of children.get(parent.index) ?? []) {
        if (elementMatches(child, part as Compound)) next.push(child);
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

function matchFlat(elements: ScannedElement[], selector: string): ScannedElement[] {
  const c = parseCompound(selector);
  if (!c) return [];
  return elements.filter((e) => elementMatches(e, c));
}

/**
 * Resolve the operated element by selector candidates: walk the candidates in
 * order and return the element matched by the first candidate that is
 * unambiguous (exactly one source element).
 */
export function resolveElement(elements: ScannedElement[], candidates: readonly string[]): ScannedElement | null {
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const candidate = unescapeCss(raw.trim());
    if (!candidate || candidate.length > 500 || seen.has(candidate)) continue;
    seen.add(candidate);
    const matches = candidate.includes(">")
      ? matchPath(elements, candidate)
      : matchFlat(elements, candidate);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) continue;
  }
  return null;
}

function siblingsOf(elements: ScannedElement[], el: ScannedElement): ScannedElement[] {
  return elements
    .filter((e) => e.parentIndex === el.parentIndex)
    .sort((a, b) => a.start - b.start);
}

/**
 * Index of the newline that starts the whitespace-only line-prefix ending at
 * `pos`; -1 when the character run before `pos` is not pure whitespace.
 */
function linePrefixStart(text: string, pos: number): number {
  const nl = text.lastIndexOf("\n", pos - 1);
  const sliceStart = nl + 1;
  if (!/^[ \t\r]*$/.test(text.slice(sliceStart, pos))) return -1;
  return nl === -1 ? 0 : nl;
}

function blockOf(text: string, el: ScannedElement): string {
  return text.slice(el.start, el.end);
}

/** Apply one structural op to the source text; null when unresolvable. */
export function applyStructureOp(
  text: string,
  op: "delete" | "duplicate" | "move-up" | "move-down",
  candidates: readonly string[]
): string | null {
  const elements = scanHtmlElements(text);
  const el = resolveElement(elements, candidates);
  if (!el) return null;
  const siblings = siblingsOf(elements, el);
  const order = siblings.findIndex((s) => s.index === el.index);
  if (order === -1) return null;

  if (op === "delete") {
    const from = linePrefixStart(text, el.start);
    return text.slice(0, from === -1 ? el.start : from) + text.slice(el.end);
  }
  if (op === "duplicate") {
    const from = linePrefixStart(text, el.start);
    const block = blockOf(text, el);
    if (from === -1) {
      // Inline element without its own line: paste the clone straight after.
      return text.slice(0, el.end) + block + text.slice(el.end);
    }
    const indent = text.slice(from + 1, el.start);
    return text.slice(0, el.end) + "\n" + indent + block + text.slice(el.end);
  }
  if (op === "move-up") {
    if (order === 0) return null;
    const prev = siblings[order - 1];
    const prevLine = linePrefixStart(text, prev.start);
    if (prevLine === -1) return null;
    const prefix = text.slice(0, prevLine + 1);
    const indentPrev = text.slice(prevLine + 1, prev.start);
    const gap = text.slice(prev.end, el.start);
    return prefix + indentPrev + blockOf(text, el) + gap + blockOf(text, prev) + text.slice(el.end);
  }
  // move-down
  if (order === siblings.length - 1) return null;
  const next = siblings[order + 1];
  const elLine = linePrefixStart(text, el.start);
  if (elLine === -1) return null;
  const prefix = text.slice(0, elLine + 1);
  const indentEl = text.slice(elLine + 1, el.start);
  const gap = text.slice(el.end, next.start);
  return prefix + indentEl + blockOf(text, next) + gap + blockOf(text, el) + text.slice(next.end);
}
