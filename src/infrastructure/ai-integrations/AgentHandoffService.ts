import * as vscode from "vscode";
import type { ElementPayload } from "../../../packages/preview-runtime/src/protocol";
import { contextToPrompt, toSelectionContext, type ElementSelectionContext } from "../../domain/entities/DesignElementContext";
import { findSourceHints } from "./SourceHintFinder";
import { resolveComponentPaths } from "./ComponentResolver";
import type { DesignChangeStore } from "../journal/DesignChangeStore";

export interface ElementHandoffResult {
  success: boolean;
  agents: string[];
  message: string;
  handoffFile?: string;
}

/**
 * Sends the selected element + human instruction to AI agent chats.
 *
 * Every handoff is persisted to `.design-studio/handoff.json` first, so any
 * connected agent (Kilo Code, Mistral Vibe, later OpenCode/Cline) can read it
 * back through the Design Studio MCP server even if chat focus fails.
 * Clipboard + chat focus is the convenience path for the open editor.
 */
export class AgentHandoffService {
  constructor(
    private readonly store: DesignChangeStore | null,
    private readonly chatCommandCandidates: Record<string, string[]>,
    private readonly workspaceRoot: string | null = null
  ) {}

  async send(element: ElementPayload, instruction: string): Promise<ElementHandoffResult> {
    if (!this.store) {
      return { success: false, agents: [], message: "Open a project folder first" };
    }
    let hints: ReturnType<typeof findSourceHints> = [];
    if (this.workspaceRoot) {
      try {
        hints = findSourceHints(this.workspaceRoot, element);
      } catch {
        hints = [];
      }
    }
    const ctx: ElementSelectionContext = toSelectionContext(element, hints);
    if (this.workspaceRoot && ctx.components) {
      try {
        ctx.components = resolveComponentPaths(this.workspaceRoot, ctx.components);
      } catch {
        // keep raw bundler paths when resolution fails
      }
    }
    this.store.writeHandoff(element, instruction);
    const prompt = contextToPrompt(ctx, instruction);

    const agents: string[] = [];
    let focused: string | null = null;
    for (const [agent, candidates] of Object.entries(this.chatCommandCandidates)) {
      if (await this.tryFocus(agent, candidates)) {
        agents.push(agent);
        focused = focused ?? agent;
      }
    }

    try {
      await vscode.env.clipboard.writeText(prompt);
    } catch (error) {
      return {
        success: false,
        agents,
        message: `Handoff saved to .design-studio/handoff.json, but clipboard failed: ${error instanceof Error ? error.message : String(error)}`,
        handoffFile: this.store.handoffPath,
      };
    }

    const focusNote = focused ? `Chat focused: ${focused}.` : "No agent chat auto-focused.";
    return {
      success: true,
      agents,
      message: `${focusNote} Prompt copied to clipboard. Element handoff saved to .design-studio/handoff.json (readable via the Design Studio MCP server).`,
      handoffFile: this.store.handoffPath,
    };
  }

  private async tryFocus(_agent: string, candidates: string[]): Promise<boolean> {
    let commands: string[];
    try {
      commands = await vscode.commands.getCommands(true);
    } catch {
      return false;
    }
    // A candidate ending in "*" matches by prefix (agent command ids vary across versions).
    const available = candidates.find((c) =>
      c.endsWith("*") ? commands.some((cmd) => cmd.startsWith(c.slice(0, -1))) : commands.includes(c)
    );
    if (!available) return false;
    const target = available.endsWith("*") ? commands.find((cmd) => cmd.startsWith(available.slice(0, -1)))! : available;
    try {
      await vscode.commands.executeCommand(target);
      return true;
    } catch {
      return false;
    }
  }
}
