import * as vscode from "vscode";
import type { DesignElementContext } from "../../../domain/entities/DesignElementContext";

export interface SendContextResult {
  success: boolean;
  method: "clipboard" | "command" | "none";
  message: string;
}

export interface KiloCapabilities {
  available: boolean;
  openInTab: boolean;
  focusChatInput: boolean;
}

export class KiloCodeAdapter {
  readonly id = "kilo-code";

  async getCapabilities(): Promise<KiloCapabilities> {
    const commands = new Set(await vscode.commands.getCommands(true));
    const openInTab = commands.has("kilo-code.new.openInTab");
    const focusChatInput = commands.has("kilo-code.new.focusChatInput");
    return {
      available: openInTab || focusChatInput,
      openInTab,
      focusChatInput,
    };
  }

  async isAvailable(): Promise<boolean> {
    const capabilities = await this.getCapabilities();
    return capabilities.available;
  }

  async sendContext(ctx: DesignElementContext, instruction: string): Promise<SendContextResult> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.available) {
      return { success: false, method: "none", message: "Kilo Code not available" };
    }

    const prompt = this.buildPrompt(ctx, instruction);
    try {
      await vscode.env.clipboard.writeText(prompt);
    } catch (error) {
      return {
        success: false,
        method: "none",
        message: `Clipboard unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let opened = false;
    let focused = false;
    if (capabilities.openInTab) {
      try {
        await vscode.commands.executeCommand("kilo-code.new.openInTab");
        opened = true;
      } catch {
        opened = false;
      }
    }
    if (capabilities.focusChatInput) {
      try {
        await vscode.commands.executeCommand("kilo-code.new.focusChatInput");
        focused = true;
      } catch {
        focused = false;
      }
    }

    const delivery = opened || focused ? "Kilo opened; " : "";
    return {
      success: true,
      method: "clipboard",
      message: `${delivery}Prompt copied to clipboard. Paste it into Kilo chat manually.`,
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