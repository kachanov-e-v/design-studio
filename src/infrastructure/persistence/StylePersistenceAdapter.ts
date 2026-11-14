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

export class StylePersistenceAdapter {
  readonly id = "css-text";

  async canEdit(): Promise<boolean> {
    return true;
  }

  async apply(change: StyleChange): Promise<PersistenceResult> {
    const files = await vscode.workspace.findFiles("**/*.css", "**/node_modules/**", 50);
    for (const uri of files) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const escaped = change.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ruleRegex = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`, "m");
      const match = text.match(ruleRegex);
      if (!match) continue;

      const body = match[2];
      const prop = change.property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const propRegex = new RegExp(`(^|;|\\s)${prop}\\s*:[^;]*;?`, "m");
      let newBody: string;
      if (propRegex.test(body)) {
        newBody = body.replace(propRegex, `$1${change.property}: ${change.value};`);
      } else {
        newBody = body.trimEnd() + (body.trim().endsWith(";") || body.trim() === "" ? " " : "; ") + `${change.property}: ${change.value}; `;
      }

      const newText = text.replace(ruleRegex, `$1${newBody}$3`);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), newText);
      const ok = await vscode.workspace.applyEdit(edit);
      if (ok) {
        await doc.save();
        return { success: true, message: "Saved to source", file: uri.fsPath };
      }
    }
    return { success: false, message: "No matching CSS rule found" };
  }
}