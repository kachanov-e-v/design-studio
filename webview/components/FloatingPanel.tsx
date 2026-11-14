import React, { useEffect, useState } from "react";
import styles from "./FloatingPanel.module.css";
import type { ElementPayload } from "../types";
import { postToExtension, onExtensionMessage } from "../bridge";

export function FloatingPanel({ selected, lastChange }: { selected: ElementPayload | null; lastChange: { selector: string; property: string; value: string } | null }): React.ReactElement {
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    return onExtensionMessage((msg) => {
      if (msg && (msg as { type?: string }).type === "kilo:result") {
        const m = msg as { success?: boolean; message?: string };
        setStatus(m.message ?? (m.success ? "Done" : "Failed"));
      }
      if (msg && (msg as { type?: string }).type === "persist:result") {
        const m = msg as { success?: boolean; message?: string };
        setStatus(m.message ?? (m.success ? "Saved" : "Save failed"));
      }
    });
  }, []);
  const sendPersist = () => {
    if (!lastChange) {
      setStatus("No change to save");
      return;
    }
    postToExtension({ type: "style:persist", selector: lastChange.selector, property: lastChange.property, value: lastChange.value });
    setStatus("Saving...");
  };
  const send = () => {
    if (!selected) {
      setStatus("Select an element first");
      return;
    }
    postToExtension({ type: "kilo:sendContext", payload: selected, instruction });
    setStatus("Sending...");
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
      <button type="button" onClick={sendPersist}>Save to source</button>
      {status && <span className={styles.status}>{status}</span>}
    </div>
  );
}