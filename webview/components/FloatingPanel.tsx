import React, { useState } from "react";
import styles from "./FloatingPanel.module.css";
import type { ElementPayload } from "../types";

export function FloatingPanel({
  selected,
  status,
  pendingChanges,
  onSendToAgent,
  onCopyMcpConfig,
}: {
  selected: ElementPayload | null;
  status: string;
  pendingChanges: number;
  onSendToAgent: (instruction: string) => void;
  onCopyMcpConfig: () => void;
}): React.ReactElement {
  const [instruction, setInstruction] = useState("");

  const send = () => {
    if (!selected) return;
    onSendToAgent(instruction);
  };

  return (
    <div className={styles.panel} role="dialog" aria-label="AI agent handoff">
      <input
        className={styles.input}
        placeholder="Describe what to change on the selected element…"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
      />
      <button type="button" onClick={send} disabled={!selected} title="Send selected element + instruction to the AI agent chat">
        Send to AI
      </button>
      <button type="button" onClick={onCopyMcpConfig} title="Copy MCP server config for Kilo Code / Mistral Vibe">
        MCP setup
      </button>
      <span className={styles.pending} title=".design-studio/changes.jsonl">
        Pending: {pendingChanges}
      </span>
      {status && <span className={styles.status}>{status}</span>}
    </div>
  );
}
