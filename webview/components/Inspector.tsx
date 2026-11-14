import React from "react";
import styles from "./Inspector.module.css";
import type { ElementPayload } from "../types";

const SECTIONS = ["Element", "Layout", "Spacing", "Typography", "Appearance", "Border", "Effects", "Position", "Advanced", "Source"];

export function Inspector({ selected, onApplyStyle }: { selected: ElementPayload | null; onApplyStyle: (p: string, v: string) => void }): React.ReactElement {
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h2 className={styles.heading}>Inspector</h2>
      {selected ? (
        <div className={styles.selected}>
          <div><strong>Tag:</strong> {selected.tag}</div>
          <div><strong>Selector:</strong> {selected.selector}</div>
          <div className={styles.editor}>
            <label>color <input value={selected.styles.color ?? ""} onChange={(e) => onApplyStyle("color", e.target.value)} /></label>
            <label>font-size <input value={selected.styles.fontSize ?? ""} onChange={(e) => onApplyStyle("font-size", e.target.value)} /></label>
            <label>background <input value={selected.styles.backgroundColor ?? ""} onChange={(e) => onApplyStyle("background-color", e.target.value)} /></label>
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
      <ul className={styles.list}>
        {SECTIONS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </aside>
  );
}