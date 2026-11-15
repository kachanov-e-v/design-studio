import * as vscode from "vscode";
import { CssSourceResolver, type SourceRule } from "./CssSourceResolver";
import { findCssRules, isValidCssProperty, isValidCssValue, type CssRuleMatch } from "./cssText";

export interface StyleChange {
  selector: string;
  selectors?: string[];
  property: string;
  value: string;
  /** Matched stylesheet rules from the preview runtime (dev servers). */
  sourceRules?: SourceRule[];
}

export interface PersistenceResult {
  success: boolean;
  message: string;
  file?: string;
}

export { findCssRules, splitTopLevelSelectors, isValidCssProperty, isValidCssValue } from "./cssText";
export type { CssRuleMatch } from "./cssText";

export class StylePersistenceAdapter {
  readonly id = "css-text";
  private readonly sourceResolver = new CssSourceResolver();

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

    if (matches.length === 1) {
      return this.editRule(matches[0].uri, matches[0].doc, matches[0].text, matches[0].rule, change, "");
    }

    // No (or ambiguous) direct match: hashed CSS Modules selectors from a dev
    // server need to be mapped back to their source files first.
    const mapped = await this.applyViaSourceMapping(change);
    if (mapped) return mapped;

    if (matches.length > 1) {
      return { success: false, message: "Ambiguous CSS rule match" };
    }
    return { success: false, message: "No matching CSS rule found" };
  }

  private async applyViaSourceMapping(change: StyleChange): Promise<PersistenceResult | null> {
    for (const rule of (change.sourceRules ?? []).slice(0, 3)) {
      const resolved = await this.sourceResolver.resolve(rule);
      if (!resolved) continue;
      const files = await vscode.workspace.findFiles(`**/${resolved.sourceFile}`, "**/node_modules/**", 5);
      for (const uri of files) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const rules = findCssRules(text, resolved.selectors);
        if (rules.length !== 1) continue;
        const note = ` (mapped to ${resolved.sourceFile} via ${resolved.via})`;
        return this.editRule(uri, doc, text, rules[0], change, note);
      }
    }
    return null;
  }

  private async editRule(
    uri: vscode.Uri,
    doc: vscode.TextDocument,
    text: string,
    rule: CssRuleMatch,
    change: StyleChange,
    note: string
  ): Promise<PersistenceResult> {
    const body = text.slice(rule.bodyStart, rule.bodyEnd);
    const propEsc = change.property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declRegex = new RegExp(`(^|[;{])\\s*${propEsc}\\s*:[^;]*;?`, "m");

    let newBody: string;
    if (change.value === "") {
      if (!declRegex.test(body)) {
        return { success: true, message: "Property is already absent", file: uri.fsPath };
      }
      newBody = body.replace(declRegex, (match) => match.match(/^([;{])/)?.[1] ?? "");
    } else if (declRegex.test(body)) {
      newBody = body.replace(declRegex, (match) => {
        const delimMatch = match.match(/^([;{])/);
        const delim = delimMatch ? delimMatch[1] : "";
        return `${delim} ${change.property}: ${change.value};`;
      });
      if (newBody === body) {
        return { success: false, message: "Property already has this value" };
      }
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
      return { success: true, message: `Saved to source${note}`, file: uri.fsPath };
    }
    return { success: false, message: "Failed to apply edit" };
  }
}

