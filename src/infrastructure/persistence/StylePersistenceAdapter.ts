import * as vscode from "vscode";

export interface StyleChange {
  selector: string;
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
  return typeof property === "string" && property.length > 0 && property.length <= 64 && /^[a-zA-Z-]+$/.test(property);
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

export function findCssRules(text: string, selector: string): CssRuleMatch[] {
  const result: CssRuleMatch[] = [];
  const regex = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const selectorText = m[1].trim();
    const selectors = selectorText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!selectors.includes(selector)) continue;
    const fullStart = m.index;
    const openBrace = text.indexOf("{", fullStart);
    const closeBrace = text.indexOf("}", openBrace);
    if (openBrace === -1 || closeBrace === -1) continue;
    result.push({
      selectorText,
      selectors,
      start: fullStart,
      end: closeBrace + 1,
      bodyStart: openBrace + 1,
      bodyEnd: closeBrace,
    });
  }
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
    const candidates: { uri: vscode.Uri; doc: vscode.TextDocument; text: string; rule: CssRuleMatch }[] = [];

    for (const uri of files) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const rules = findCssRules(text, change.selector);
      for (const rule of rules) {
        candidates.push({ uri, doc, text, rule });
      }
    }

    if (candidates.length === 0) {
      return { success: false, message: "No matching CSS rule found" };
    }
    if (candidates.length > 1) {
      return { success: false, message: "Ambiguous CSS rule match" };
    }

    const { uri, doc, text, rule } = candidates[0];
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

