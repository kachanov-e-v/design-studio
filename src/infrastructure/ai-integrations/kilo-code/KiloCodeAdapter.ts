import * as vscode from "vscode";
import type { DesignElementContext } from "../../../domain/entities/DesignElementContext";

export interface SendContextResult {
  success: boolean;
  method: "clipboard" | "command" | "none";
  message: string;
}

export class KiloCodeAdapter {
  readonly id = "kilo-code";

  async isAvailable(): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    return commands.includes("kilo-code.new.focusChatInput");
  }

  async sendContext(ctx: DesignElementContext, instruction: string): Promise<SendContextResult> {
    const available = await this.isAvailable();
    if (!available) {
      return { success: false, method: "none", message: "Kilo Code not available" };
    }

    const prompt = this.buildPrompt(ctx, instruction);
    await vscode.env.clipboard.writeText(prompt);

    try {
      await vscode.commands.executeCommand("kilo-code.new.openInTab");
    } catch {
      // ignore
    }
    try {
      await vscode.commands.executeCommand("kilo-code.new.focusChatInput");
    } catch {
      // ignore
    }

    return {
      success: true,
      method: "clipboard",
      message: "Context copied to clipboard. Paste into Kilo chat.",
    };
  }

  private buildPrompt(ctx: DesignElementContext, instruction: string): string {
    const styles = Object.entries(ctx.styles)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    return [
      "Design Studio context (v1)",
      `Element: ${ctx.tag} (${ctx.selector})`,
      `Styles: ${styles}`,
      `Instruction: ${instruction}`,
      "Please apply the requested change in source files.",
    ].join("\n");
  }
}