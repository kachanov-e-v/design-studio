import * as vscode from "vscode";
import { openDesignStudio } from "./commands/openDesignStudio";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("design-studio.open", () => openDesignStudio(context));
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // no-op
}