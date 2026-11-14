import React, { useState } from "react";
import styles from "./FloatingPanel.module.css";
import type { ElementPayload } from "../types";

export function FloatingPanel({
  selected,
  lastChange,
  status,
  onSave,
  onSendContext,
}: {
  selected: ElementPayload | null;
  lastChange: { selector: string; property: string; value: string } | null;
  status: string;
  onSave: () => void;
  onSendContext: (instruction: string) => void;
}): React.ReactElement {
  const [instruction, setInstruction] = useState("");

  const sendPersist = () => {
    if (!lastChange) {
      return;
    }
    onSave();
  };
  const send = () => {
    if (!selected) return;
    onSendContext(instruction);
  };

  return (
    <div className={styles.panel} role="dialog" aria-label="Kilo actions">
      <input
        className={styles.input}
        placeholder="Instruction for Kilo"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <button type="button" onClick={send}>Copy to Kilo</button>
      <button type="button" onClick={sendPersist} disabled={!lastChange}>Save to source</button>
      {status && <span className={styles.status}>{status}</span>}
    </div>
  );
}