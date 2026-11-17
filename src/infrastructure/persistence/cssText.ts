export interface CssRuleMatch {
  selectorText: string;
  selectors: string[];
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}
export function isValidCssProperty(property: string): boolean {
  return typeof property === "string" && property.length <= 64 && /^(?:--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/.test(property);
}
export function isValidCssValue(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 500 &&
    !/[{};]/.test(value) &&
    !hasUnclosedComment(value) &&
    !Array.from(value).some((ch) => ch.charCodeAt(0) < 0x20)
  );
}
// An unclosed "/*" would comment out the rest of the stylesheet once written.
function hasUnclosedComment(value: string): boolean {
  let i = value.indexOf("/*");
  while (i !== -1) {
    const end = value.indexOf("*/", i + 2);
    if (end === -1) return true;
    i = value.indexOf("/*", end + 2);
  }
  return false;
}
const PSEUDO_ELEMENT_SINGLE = /(?<!:):(before|after|first-line|first-letter|placeholder|selection|marker|backdrop)(?![a-zA-Z-])/g;
// Normalized form used only for comparisons: whitespace collapsed, legacy single-colon
// pseudo-elements mapped to their double-colon names, identifier escapes stripped.
export function normalizeCssSelector(selector: string): string {
  const escaped = selector.trim().replace(/\\(\r?\n)/g, "").replace(/\\(.)/g, "$1");
  return escaped.replace(/\s+/g, " ").replace(PSEUDO_ELEMENT_SINGLE, "::$1");
}
export function splitTopLevelSelectors(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      const trimmed = current.trim().replace(/\s+/g, " ");
      if (trimmed) result.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim().replace(/\s+/g, " ");
  if (trimmed) result.push(trimmed);
  return result;
}
export function findCssRules(text: string, selector: string | string[]): CssRuleMatch[] {
  const candidates = Array.isArray(selector) ? selector : [selector];
  const wanted = candidates
    .filter((s) => typeof s === "string" && s.length > 0)
    .flatMap(splitTopLevelSelectors)
    .map(normalizeCssSelector);
  const result: CssRuleMatch[] = [];
  const findMatchingBrace = (start: number): number => {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i += 1;
        while (i < text.length && text[i] !== quote) {
          if (text[i] === "\\") i += 1;
          i += 1;
        }
        i += 1;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  };
  const parse = (from: number, to: number): void => {
    let i = from;
    while (i < to) {
      while (i < to && /\s/.test(text[i])) i += 1;
      if (i >= to) break;
      if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        i = end === -1 ? to : end + 2;
        continue;
      }
      if (text[i] === "@") {
        let j = i;
        while (j < to && text[j] !== "{" && text[j] !== ";") {
          if (text.startsWith("/*", j)) {
            const end = text.indexOf("*/", j + 2);
            j = end === -1 ? to : end + 2;
            continue;
          }
          j += 1;
        }
        if (j >= to || text[j] === ";") {
          i = Math.min(to, j + 1);
          continue;
        }
        const close = findMatchingBrace(j);
        if (close === -1 || close > to) {
          i = j + 1;
          continue;
        }
        parse(j + 1, close);
        i = close + 1;
        continue;
      }
      let j = i;
      while (j < to && text[j] !== "{") {
        if (text.startsWith("/*", j)) {
          const end = text.indexOf("*/", j + 2);
          j = end === -1 ? to : end + 2;
          continue;
        }
        j += 1;
      }
      if (j >= to) break;
      const selectorText = text.slice(i, j).trim();
      const close = findMatchingBrace(j);
      if (close === -1 || close > to) break;
      const selectors = splitTopLevelSelectors(selectorText);
      if (selectors.length > 0 && selectors.map(normalizeCssSelector).some((s) => wanted.includes(s))) {
        result.push({
          selectorText,
          selectors,
          start: i,
          end: close + 1,
          bodyStart: j + 1,
          bodyEnd: close,
        });
      }
      i = close + 1;
    }
  };
  parse(0, text.length);
  return result;
}

export interface CssDeclarationSpan {
  property: string;
  start: number;
  end: number;
}
// Top-level declarations of a rule body. Nested blocks, comments, quoted strings
// and parenthesised values (url(...)) are skipped, so a property that only appears
// inside them is never matched as a top-level declaration.
export function findTopLevelDeclarations(body: string): CssDeclarationSpan[] {
  const result: CssDeclarationSpan[] = [];
  let depth = 0;
  let parenDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let identStart = -1;
  let i = 0;
  const findDeclEnd = (from: number): number => {
    let j = from;
    let inS = false;
    let inDq = false;
    let parens = 0;
    while (j < body.length) {
      const ch = body[j];
      if (inS) {
        if (ch === "\\") j += 1;
        else if (ch === "'") inS = false;
        j += 1;
        continue;
      }
      if (inDq) {
        if (ch === "\\") j += 1;
        else if (ch === '"') inDq = false;
        j += 1;
        continue;
      }
      if (ch === "'") {
        inS = true;
        j += 1;
        continue;
      }
      if (ch === '"') {
        inDq = true;
        j += 1;
        continue;
      }
      if (ch === "/" && body[j + 1] === "*") {
        const end = body.indexOf("*/", j + 2);
        j = end === -1 ? body.length : end + 2;
        continue;
      }
      if (ch === "(") {
        parens += 1;
      } else if (ch === ")") {
        if (parens > 0) parens -= 1;
      } else if (ch === ";" && parens === 0) {
        return j + 1;
      }
      j += 1;
    }
    return body.length;
  };
  while (i < body.length) {
    const ch = body[i];
    if (inSingle) {
      if (ch === "\\") i += 1;
      else if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? body.length : end + 2;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      identStart = -1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      identStart = -1;
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      identStart = -1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === ";") {
      identStart = -1;
      i += 1;
      continue;
    }
    if (/[A-Za-z-]/.test(ch)) {
      if (identStart === -1) identStart = i;
      i += 1;
      continue;
    }
    if (ch === ":" && identStart !== -1) {
      const property = body.slice(identStart, i);
      const end = findDeclEnd(i + 1);
      result.push({ property, start: identStart, end });
      i = end;
      identStart = -1;
      continue;
    }
    identStart = -1;
    i += 1;
  }
  return result;
}