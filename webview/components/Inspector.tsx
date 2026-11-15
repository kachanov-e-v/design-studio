import React, { useEffect, useState } from "react";
import styles from "./Inspector.module.css";
import type { ElementOp, ElementPayload } from "../types";
import { translate, type Language } from "@design-studio/shared/i18n";

const EDITABLE_STYLE_PROPS = [
  "display", "position", "width", "min-width", "max-width", "height", "min-height", "max-height",
  "color", "background-color", "opacity", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "padding", "margin", "gap", "border", "border-radius", "box-shadow", "flex-direction", "justify-content", "align-items", "grid-template-columns", "overflow",
];

const BLOCK_OPS: { op: ElementOp; key: "inspector.moveUp" | "inspector.moveDown" | "inspector.duplicate" | "inspector.delete" }[] = [
  { op: "move-up", key: "inspector.moveUp" },
  { op: "move-down", key: "inspector.moveDown" },
  { op: "duplicate", key: "inspector.duplicate" },
  { op: "delete", key: "inspector.delete" },
];

export function Inspector({
  selected,
  onApplyStyle,
  onApplyOp,
  onEditText,
  onCopyComponent,
  language,
  error,
}: {
  selected: ElementPayload | null;
  onApplyStyle: (property: string, value: string) => void;
  onApplyOp: (op: ElementOp, value?: string) => void;
  onEditText: (text: string) => void;
  onCopyComponent: (component: { name?: string; file?: string; line?: number }) => void;
  language: Language;
  error?: string;
}): React.ReactElement {
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState<string | null>(null);
  const [customProperty, setCustomProperty] = useState("");
  const [customValue, setCustomValue] = useState("");
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const applyClasses = () => {
    if (classDraft === null) return;
    onApplyOp("set-classes", classDraft.trim().split(/\s+/).filter(Boolean).join(" "));
    setClassDraft(null);
  };

  useEffect(() => {
    setTextDraft(null);
    setClassDraft(null);
  }, [selected?.selector]);

  return (
    <aside className={styles.inspector} aria-label={t("inspector.title")}>
      <div className={styles.heading}>{t("inspector.title")}</div>
      {error && <div className={styles.error}>{error}</div>}
      {selected ? (
        <div className={styles.body}>
          <div className={styles.identity}>
            <div><span>{t("inspector.tag")}</span><b>{selected.tag}</b></div>
            <div title={selected.selector}><span>{t("inspector.selector")}</span><code>{selected.selector}</code></div>
          </div>

          {selected.component?.length ? (
            <section className={styles.section}>
              <h3>{t("inspector.component")}</h3>
              <div className={styles.componentList}>
                {selected.component.map((component, index) => (
                  <div className={styles.component} key={`${component.name ?? "component"}-${component.file ?? index}-${index}`}>
                    <div className={styles.componentInfo}>
                      <strong>{component.name ?? (language === "ru" ? "Компонент React" : "React component")}</strong>
                      <code title={component.file}>{component.file ? `${component.file}${component.line ? `:${component.line}` : ""}` : t("inspector.noSource")}</code>
                    </div>
                    <button type="button" disabled={!component.file} onClick={() => onCopyComponent(component)} title={t("inspector.copySource")}>
                      {t("inspector.copySource")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className={styles.section}>
            <h3>{t("inspector.text")}</h3>
            <div className={styles.row}>
              <input
                value={textDraft ?? selected.text ?? ""}
                placeholder={t("inspector.noText")}
                onChange={(event) => setTextDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && textDraft !== null && textDraft !== (selected.text ?? "")) {
                    onEditText(textDraft);
                    setTextDraft(null);
                  }
                }}
              />
              <button type="button" disabled={textDraft === null || textDraft === (selected.text ?? "")} onClick={() => {
                if (textDraft !== null) onEditText(textDraft);
                setTextDraft(null);
              }}>{t("inspector.apply")}</button>
            </div>
          </section>

          <section className={styles.section}>
            <h3>{t("inspector.classes")}</h3>
            <input
              className={styles.classInput}
              value={classDraft ?? (selected.classes ?? []).join(" ")}
              placeholder={t("inspector.classesPlaceholder")}
              onChange={(event) => setClassDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyClasses(); }}
            />
            <button className={styles.inlineAction} type="button" disabled={classDraft === null || classDraft === (selected.classes ?? []).join(" ")} onClick={() => {
              applyClasses();
            }}>{t("inspector.applyClasses")}</button>
            {selected.tailwind && <p className={styles.note}>{t("inspector.tailwind")}</p>}
          </section>

          <section className={styles.section}>
            <h3>{t("inspector.structure")}</h3>
            <div className={styles.actions}>
              {BLOCK_OPS.map(({ op, key }) => <button key={op} type="button" onClick={() => onApplyOp(op)}>{t(key)}</button>)}
            </div>
          </section>

          <section className={styles.section}>
            <h3>{t("inspector.styles")}</h3>
            <div className={styles.editor}>
              {EDITABLE_STYLE_PROPS.map((property) => (
                <label key={property}>
                  <span>{property}</span>
                  <input
                    value={selected.styles[property] ?? ""}
                    onChange={(event) => onApplyStyle(property, event.target.value)}
                    onBlur={(event) => {
                      if (event.target.value !== (selected.styles[property] ?? "")) onApplyStyle(property, event.target.value);
                    }}
                  />
                </label>
              ))}
            </div>
            <div className={styles.customStyle}>
              <h4>{t("inspector.customStyle")}</h4>
              <div className={styles.customFields}>
                <input value={customProperty} onChange={(event) => setCustomProperty(event.target.value)} placeholder={t("inspector.propertyPlaceholder")} />
                <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder={t("inspector.valuePlaceholder")} />
              </div>
              <button className={styles.inlineAction} type="button" disabled={!customProperty.trim()} onClick={() => {
                onApplyStyle(customProperty.trim(), customValue);
                setCustomProperty("");
                setCustomValue("");
              }}>{t("inspector.apply")}</button>
            </div>
          </section>
        </div>
      ) : (
        <p className={styles.empty}>{t("inspector.empty")}</p>
      )}
    </aside>
  );
}
