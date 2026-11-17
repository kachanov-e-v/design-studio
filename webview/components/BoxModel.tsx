import React, { useState } from "react";
import styles from "./BoxModel.module.css";
import { composeBoxSides, expandBoxSides } from "./propertyRegistry";

const SIDES = ["top", "right", "bottom", "left"] as const;
const SIDE_CLASSES = [styles.sideTop, styles.sideRight, styles.sideBottom, styles.sideLeft];

type BoxProperty = "margin" | "border-width" | "padding";

const RINGS: { property: BoxProperty; className: string }[] = [
  { property: "margin", className: styles.marginRing },
  { property: "border-width", className: styles.borderRing },
  { property: "padding", className: styles.paddingRing },
];

/** Devtools-style box model: editable per-side values recompose the CSS shorthand. */
export function BoxModel({
  elementStyles,
  rect,
  onApplyStyle,
}: {
  elementStyles: Record<string, string>;
  rect: { width: number; height: number };
  onApplyStyle: (property: string, value: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState<{ property: BoxProperty; side: number; value: string } | null>(null);

  const commit = () => {
    if (!editing) return;
    const sides = expandBoxSides(elementStyles[editing.property] ?? "");
    if (sides) {
      const next = [...sides] as [string, string, string, string];
      next[editing.side] = editing.value.trim() || "0";
      onApplyStyle(editing.property, composeBoxSides(next));
    }
    setEditing(null);
  };

  const renderRing = (ringIndex: number, children: React.ReactNode): React.ReactNode => {
    const { property, className } = RINGS[ringIndex];
    const sides = expandBoxSides(elementStyles[property] ?? "");
    return (
      <div className={`${styles.ring} ${className}`}>
        <span className={styles.ringLabel}>{property === "border-width" ? "border" : property}</span>
        {SIDES.map((side, index) => {
          const isEditing = editing?.property === property && editing.side === index;
          if (isEditing) {
            return (
              <input
                key={side}
                className={`${styles.sideInput} ${SIDE_CLASSES[index]}`}
                value={editing.value}
                autoFocus
                aria-label={`${property} ${side}`}
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
                  if (event.key === "Escape") setEditing(null);
                }}
                onBlur={commit}
              />
            );
          }
          return (
            <button
              key={side}
              type="button"
              className={`${styles.sideCell} ${SIDE_CLASSES[index]}`}
              disabled={!sides}
              title={sides ? `${property}-${side}` : (elementStyles[property] ?? "")}
              aria-label={`${property} ${side}`}
              onClick={() => sides && setEditing({ property, side: index, value: sides[index] })}
            >
              {sides ? sides[index] : "–"}
            </button>
          );
        })}
        <div className={styles.center}>{children}</div>
      </div>
    );
  };

  return (
    <div className={styles.boxModel} aria-label="box model">
      {renderRing(0, renderRing(1, renderRing(2, (
        <span className={styles.contentSize}>
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      ))))}
    </div>
  );
}