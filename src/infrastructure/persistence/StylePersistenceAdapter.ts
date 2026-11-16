import * as vscode from "vscode";
import { CssSourceResolver, type SourceRule } from "./CssSourceResolver";
import { findCssRules, isValidCssProperty, isValidCssValue, type CssRuleMatch } from "./cssText";

/** Cap on scanned CSS files; a full hit means the candidate list is truncated. */
const CSS_SEARCH_LIMIT = 200;
/** Build outputs hold compiled CSS that must never be edited nor searched. */
const CSS_EXCLUDE_GLOB = "**/{node_modules,.next,dist,build,out,coverage,.git}/**";

function pathSuffixMatches(uri: vscode.Uri, sourcePath: string): boolean {
  const fsPath = uri.fsPath.replace(/\\/g, "/").toLowerCase();
  const hint = sourcePath.replace(/^\.?\//, "").replace(/^\/+/, "").toLowerCase();
  return fsPath === hint || fsPath.endsWith(`/${hint}`);
}

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

    const files = await vscode.workspace.findFiles("**/*.css", CSS_EXCLUDE_GLOB, CSS_SEARCH_LIMIT);
    // findFiles truncates silently: a full hit on the cap means candidates may
    // be missing, so the tail must not report a confident "no match".
    const cssListTruncated = files.length >= CSS_SEARCH_LIMIT;
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
    if (cssListTruncated) {
      return { success: false, message: "Ambiguous CSS rule match: CSS file search truncated" };
    }
    return { success: false, message: "No matching CSS rule found" };
  }

  private async applyViaSourceMapping(change: StyleChange): Promise<PersistenceResult | null> {
    const rules = (change.sourceRules ?? []).slice(0, 3);
    let sawAmbiguity = false;
    for (const rule of rules) {
      const resolved = await this.sourceResolver.resolve(rule);
      if (!resolved) continue;
      // Same basenames can live in different folders: gather every candidate
      // with a unique rule and disambiguate by the source-map path instead of
      // silently editing the first hit.
      const files = await vscode.workspace.findFiles(`**/${resolved.sourceFile}`, CSS_EXCLUDE_GLOB, 25);
      const candidates: { uri: vscode.Uri; doc: vscode.TextDocument; text: string; rule: CssRuleMatch }[] = [];
      for (const uri of files) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const found = findCssRules(text, resolved.selectors);
        if (found.length !== 1) continue;
        candidates.push({ uri, doc, text, rule: found[0] });
      }
      if (candidates.length === 0) continue;
      let selected = candidates;
      if (resolved.sourcePath && candidates.length > 1) {
        const byPath = candidates.filter((c) => pathSuffixMatches(c.uri, resolved.sourcePath!));
        if (byPath.length > 0) selected = byPath;
      }
      if (selected.length > 1) {
        sawAmbiguity = true;
        continue;
      }
      const match = selected[0];
      const note = ` (mapped to ${resolved.sourceFile} via ${resolved.via})`;
      return this.editRule(match.uri, match.doc, match.text, match.rule, change, note);
    }
    if (sawAmbiguity) {
      return { success: false, message: "Ambiguous CSS rule match: source file resolves to several paths" };
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

