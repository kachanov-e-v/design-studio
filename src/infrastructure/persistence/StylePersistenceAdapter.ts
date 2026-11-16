import * as vscode from "vscode";
import { CssSourceResolver, type SourceRule } from "./CssSourceResolver";
import { findCssRules, findTopLevelDeclarations, isValidCssProperty, isValidCssValue, type CssRuleMatch } from "./cssText";

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
    // P2-7: only top-level declarations of the body are matched, so nested rule
    // blocks, comments and parenthesised values never collide with the edit.
    const decls = findTopLevelDeclarations(body);
    const decl = decls.find((d) => d.property.toLowerCase() === change.property.toLowerCase());

    let newBody: string;
    if (change.value === "") {
      if (!decl) {
        return { success: true, message: "Property is already absent", file: uri.fsPath };
      }
      newBody = body.slice(0, decl.start) + body.slice(decl.end);
    } else if (decl) {
      const raw = body.slice(decl.start, decl.end);
      const valueText = raw.slice(raw.indexOf(":") + 1).replace(/;\s*$/, "").trim();
      const hadImportant = /!\s*important/i.test(valueText);
      const baseValue = valueText.replace(/!\s*important$/i, "").trim();
      if (baseValue === change.value || valueText === change.value) {
        // UX-01: a no-op is a success — the target state already holds. Reporting
        // it as a failure left the edit in the webview pending queue forever
        // (acks are only drained on success).
        return { success: true, message: "Property already has this value", file: uri.fsPath };
      }
      const important = hadImportant && !/!\s*important/i.test(change.value) ? " !important" : "";
      newBody = body.slice(0, decl.start) + `${change.property}: ${change.value}${important};` + body.slice(decl.end);
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
      // P2-7: doc.save() would also commit the user's own unsaved changes;
      // for a dirty document the applied edit stays in the editor buffer only.
      if (doc.isDirty) {
        return { success: true, message: `Applied in editor (document has unsaved changes, not saved)${note}`, file: uri.fsPath };
      }
      await doc.save();
      return { success: true, message: `Saved to source${note}`, file: uri.fsPath };
    }
    return { success: false, message: "Failed to apply edit" };
  }
}
