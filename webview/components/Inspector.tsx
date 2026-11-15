import React, { useState } from "react";
import styles from "./Inspector.module.css";
import type { ElementOp, ElementPayload } from "../types";

const EDITABLE_STYLE_PROPS = [
  "display",
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "padding",
  "margin",
  "border-radius",
  "width",
  "height",
  "gap",
];

const BLOCK_OPS: { op: ElementOp; label: string }[] = [
  { op: "move-up", label: "Move up" },
  { op: "move-down", label: "Move down" },
  { op: "duplicate", label: "Duplicate" },
  { op: "delete", label: "Delete" },
];

export function Inspector({
  selected,
  onApplyStyle,
  onApplyOp,
  onEditText,
  error,
}: {
  selected: ElementPayload | null;
  onApplyStyle: (p: string, v: string) => void;
  onApplyOp: (op: ElementOp, value?: string) => void;
  onEditText: (text: string) => void;
  error?: string;
}): React.ReactElement {
  const [textDraft, setTextDraft] = useState<string | null>(null);

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h2 className={styles.heading}>Inspector</h2>
      {error && <div className={styles.error}>{error}</div>}
      {selected ? (
        <div className={styles.selected}>
          <div>
            <strong>Tag:</strong> {selected.tag}
          </div>
          <div className={styles.selector} title={selected.selector}>
            <strong>Selector:</strong> {selected.selector}
          </div>
          <div className={styles.selector} title={(selected.classes ?? []).join(" ")}>
            <strong>Classes:</strong>{" "}
            {(selected.classes ?? []).length > 0 ? (selected.classes ?? []).join(" ") : "—"}
            {selected.tailwind === true ? " (Tailwind)" : ""}
          </div>

          <h3 className={styles.subheading}>Text</h3>
          <div className={styles.row}>
            <input
              value={textDraft ?? selected.text ?? ""}
              placeholder="No text"
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && textDraft !== null && textDraft !== (selected.text ?? "")) {
                  onEditText(textDraft);
                  setTextDraft(null);
                }
              }}
            />
            <button
              type="button"
              disabled={textDraft === null || textDraft === (selected.text ?? "")}
              onClick={() => {
                if (textDraft !== null) onEditText(textDraft);
                setTextDraft(null);
              }}
            >
              Apply
            </button>
          </div>

          <h3 className={styles.subheading}>Block</h3>
          <div className={styles.blockOps}>
            {BLOCK_OPS.map((b) => (
              <button key={b.op} type="button" onClick={() => onApplyOp(b.op)}>
                {b.label}
              </button>
            ))}
          </div>

          <h3 className={styles.subheading}>Styles</h3>
          {selected.tailwind === true && (
            <div className={styles.selector}>
              Tailwind detected — style edits become utility classes and are recorded for your AI agent.
            </div>
          )}
          <div className={styles.editor}>
            {EDITABLE_STYLE_PROPS.map((prop) => (
              <label key={prop}>
                {prop}{" "}
                <input
                  value={selected.styles[prop] ?? ""}
                  onChange={(e) => onApplyStyle(prop, e.target.value)}
                  onBlur={(e) => {
                    if (e.target.value !== (selected.styles[prop] ?? "")) onApplyStyle(prop, e.target.value);
                  }}
                />
              </label>
            ))}
          </div>

          <h3 className={styles.subheading}>Computed</h3>
          <div className={styles.styles}>
            {Object.entries(selected.styles).map(([k, v]) => (
              <div key={k}>
                {k}: {v}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.empty}>
          Select an element in preview (Edit mode). Double-click to edit text inline.
        </p>
      )}
    </aside>
  );
}
