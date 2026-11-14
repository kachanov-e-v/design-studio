import React from "react";
import styles from "./Inspector.module.css";
import type { ElementPayload } from "../types";

export function Inspector({ selected, onApplyStyle, error }: { selected: ElementPayload | null; onApplyStyle: (p: string, v: string) => void; error?: string }): React.ReactElement {
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h2 className={styles.heading}>Inspector</h2>
      {error && <div className={styles.error}>{error}</div>}
      {selected ? (
        <div className={styles.selected}>
          <div><strong>Tag:</strong> {selected.tag}</div>
          <div><strong>Selector:</strong> {selected.selector}</div>
          <div className={styles.editor}>
            <label>color <input value={selected.styles.color ?? ""} onChange={(e) => onApplyStyle("color", e.target.value)} /></label>
            <label>font-size <input value={selected.styles["font-size"] ?? ""} onChange={(e) => onApplyStyle("font-size", e.target.value)} /></label>
            <label>background-color <input value={selected.styles["background-color"] ?? ""} onChange={(e) => onApplyStyle("background-color", e.target.value)} /></label>
          </div>
          <div className={styles.styles}>
            {Object.entries(selected.styles).map(([k, v]) => (
              <div key={k}>{k}: {v}</div>
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.empty}>Select an element in preview (edit mode).</p>
      )}
    </aside>
  );
}
