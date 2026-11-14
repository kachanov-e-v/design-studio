import * as vscode from "vscode";
import { STYLE_PROPS } from "../../shared/protocol";

export interface StyleChange {
  selector: string;
  selectors?: string[];
  property: string;
  value: string;
}

export interface PersistenceResult {
  success: boolean;
  message: string;
  file?: string;
}

export interface CssRuleMatch {
  selectorText: string;
  selectors: string[];
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}

export function isValidCssProperty(property: string): boolean {
  return typeof property === "string" && property.length > 0 && property.length <= 64 && STYLE_PROPS.includes(property);
}

export function isValidCssValue(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !/[{};]/.test(value) &&
    !Array.from(value).some((ch) => ch.charCodeAt(0) < 0x20)
  );
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
  const wanted = candidates.filter((s) => typeof s === "string" && s.length > 0).map((s) => s.trim().replace(/\s+/g, " "));
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
      if (selectors.length > 0 && selectors.some((s) => wanted.includes(s))) {
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

export class StylePersistenceAdapter {
  readonly id = "css-text";

  async canEdit(): Promise<boolean> {
    return true;
  }

  async apply(change: StyleChange): Promise<PersistenceResult> {
    if (!isValidCssProperty(change.property)) {
      return { success: false, message: "Invalid CSS property" };
    }
    if (!isValidCssValue(change.value)) {
      return { success: false, message: "Invalid CSS value" };
    }

    const files = await vscode.workspace.findFiles("**/*.css", "**/node_modules/**", 50);
    const matches: { uri: vscode.Uri; doc: vscode.TextDocument; text: string; rule: CssRuleMatch }[] = [];

    for (const uri of files) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const selectorCandidates = change.selectors?.length ? change.selectors : [change.selector];
      const rules = findCssRules(text, selectorCandidates);
      for (const rule of rules) {
        matches.push({ uri, doc, text, rule });
      }
    }

    if (matches.length === 0) {
      return { success: false, message: "No matching CSS rule found" };
    }
    if (matches.length > 1) {
      return { success: false, message: "Ambiguous CSS rule match" };
    }

    const { uri, doc, text, rule } = matches[0];
    const body = text.slice(rule.bodyStart, rule.bodyEnd);
    const propEsc = change.property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declRegex = new RegExp(`(^|[;{])\\s*${propEsc}\\s*:[^;]*;?`, "m");

    let newBody: string;
    if (declRegex.test(body)) {
      newBody = body.replace(declRegex, (match) => {
        const delimMatch = match.match(/^([;{])/);
        const delim = delimMatch ? delimMatch[1] : "";
        return `${delim} ${change.property}: ${change.value};`;
      });
    } else {
      const trimmed = body.trimEnd();
      const sep = trimmed === "" || trimmed.endsWith(";") || trimmed.endsWith("{") ? " " : "; ";
      newBody = trimmed + sep + `${change.property}: ${change.value};`;
      if (body.endsWith("\n")) newBody += "\n";
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(doc.positionAt(rule.bodyStart), doc.positionAt(rule.bodyEnd)), newBody);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      await doc.save();
      return { success: true, message: "Saved to source", file: uri.fsPath };
    }
    return { success: false, message: "Failed to apply edit" };
  }
}

