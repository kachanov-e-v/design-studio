import React, { useEffect, useState } from "react";
import styles from "./Inspector.module.css";
import { EDITABLE_ATTRIBUTES } from "@design-studio/preview-runtime/protocol";
import type { EditableAttribute, ElementOp, ElementPayload } from "../types";
import { translate, type Language } from "@design-studio/shared/i18n";
import {
  PROPERTY_DEFINITIONS,
  PROPERTY_GROUP_LABEL_KEYS,
  attributeDefinitionsForTag,
  cssColorToHex,
  parseUnitValue,
  type AttributeDefinition,
  type PropertyDefinition,
} from "./propertyRegistry";

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
  onApplyOp: (op: ElementOp, value?: string, attribute?: EditableAttribute) => void;
  onEditText: (text: string) => void;
  onCopyComponent: (component: { name?: string; file?: string; line?: number }) => void;
  language: Language;
  error?: string;
}): React.ReactElement {
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState<string | null>(null);
  const [styleDrafts, setStyleDrafts] = useState<Record<string, string>>({});
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const classes = selected?.classes ?? [];
  const setAttributeDraft = (name: string, value: string) => setAttributeDrafts((p) => ({ ...p, [name]: value }));
  const clearAttributeDraft = (name: string) => setAttributeDrafts((p) => {
    const next = { ...p };
    delete next[name];
    return next;
  });
  const setStyleDraft = (key: string, value: string) => setStyleDrafts((p) => ({ ...p, [key]: value }));
  const clearStyleDraft = (key: string) => setStyleDrafts((p) => {
    const next = { ...p };
    delete next[key];
    return next;
  });

  const removeClass = (index: number) => {
    onApplyOp("set-classes", classes.filter((_, i) => i !== index).join(" "));
  };
  const addClass = (token: string) => {
    const name = token.trim();
    if (!name || classes.includes(name)) return;
    onApplyOp("set-classes", [...classes, name].join(" "));
  };

  useEffect(() => {
    setTextDraft(null);
    setClassDraft(null);
    setStyleDrafts({});
    setAttributeDrafts({});
  }, [selected?.selector]);

  const renderAttributeEditor = (name: EditableAttribute, def: AttributeDefinition | undefined) => {
    if (!selected) return null;
    const current = selected.attributes?.[name] ?? "";
    const present = name in (selected.attributes ?? {});
    const draft = attributeDrafts[name];
    const apply = (value: string) => {
      onApplyOp("set-attribute", value, name);
      clearAttributeDraft(name);
    };
    const commit = () => {
      if (draft === undefined || draft === current) return;
      apply(draft);
    };
    if (!def || def.editor === "toggle") {
      if (!def) {
        // A whitelisted attribute present on the element without a tag-specific definition.
        return (
          <label key={name}>
            <span>{name}</span>
            <input
              value={draft ?? current}
              onChange={(event) => setAttributeDraft(name, event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") clearAttributeDraft(name); }}
              onBlur={commit}
            />
          </label>
        );
      }
      return (
        <label key={name} className={styles.toggleRow}>
          <input type="checkbox" checked={present} onChange={(event) => apply(event.target.checked ? "true" : "")} />
          <span>{name}</span>
        </label>
      );
    }
    if (def.editor === "select") {
      const options = def.options ?? [];
      const known = current === "" || options.some((option) => option.value === current);
      return (
        <label key={name}>
          <span>{name}</span>
          <select value={current} onChange={(event) => { if (event.target.value !== current) apply(event.target.value); }}>
            <option value="">—</option>
            {(known ? options : [{ label: current, value: current }, ...options]).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      );
    }
    if (def.editor === "number") {
      return (
        <label key={name}>
          <span>{name}</span>
          <input
            value={draft ?? current}
            inputMode={/^(rows|cols|width|height|tabindex|minlength|maxlength)$/.test(name) ? "numeric" : "text"}
            onChange={(event) => setAttributeDraft(name, event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") clearAttributeDraft(name); }}
            onBlur={commit}
          />
        </label>
      );
    }
    if (def.editor === "textarea") {
      return (
        <label key={name} className={styles.wideField}>
          <span>{name}</span>
          <textarea
            rows={2}
            value={draft ?? current}
            onChange={(event) => setAttributeDraft(name, event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commit(); } if (event.key === "Escape") clearAttributeDraft(name); }}
            onBlur={commit}
          />
        </label>
      );
    }
    return (
      <label key={name}>
        <span>{name}</span>
        <input
          type={def.editor === "url" ? "url" : "text"}
          value={draft ?? current}
          placeholder={def.editor === "url" ? (t("inspector.valuePlaceholder")) : undefined}
          onChange={(event) => setAttributeDraft(name, event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") clearAttributeDraft(name); }}
          onBlur={commit}
        />
      </label>
    );
  };

  const renderStyleControl = (def: PropertyDefinition) => {
    if (!selected) return null;
    const current = selected.styles[def.key] ?? "";
    const draft = styleDrafts[def.key];
    const apply = (value: string) => {
      onApplyStyle(def.key, value);
      clearStyleDraft(def.key);
    };
    const commit = () => {
      if (draft === undefined || draft === current) return;
      apply(draft);
    };
    const textInput = (
      <input
        value={draft ?? current}
        onChange={(event) => setStyleDraft(def.key, event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") clearStyleDraft(def.key); }}
        onBlur={commit}
      />
    );
    if (def.editor === "select") {
      const options = def.options ?? [];
      const known = current === "" || options.includes(current);
      return (
        <label key={def.key}>
          <span>{def.key}</span>
          <select value={current} onChange={(event) => { if (event.target.value !== current) apply(event.target.value); }}>
            <option value="">—</option>
            {(known ? options : [current, ...options]).map((option) => (
              <option key={option} value={option}>{option === "" ? "—" : option}</option>
            ))}
          </select>
        </label>
      );
    }
    if (def.editor === "color") {
      const hex = cssColorToHex(draft ?? current);
      return (
        <label key={def.key}>
          <span>{def.key}</span>
          <span className={styles.colorField}>
            {hex && <input type="color" value={hex} onChange={(event) => apply(event.target.value)} aria-label={def.key} />}
            {textInput}
          </span>
        </label>
      );
    }
    if (def.editor === "slider") {
      const numeric = Number.parseFloat(current);
      return (
        <label key={def.key}>
          <span>{def.key}</span>
          <span className={styles.sliderField}>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={Number.isFinite(numeric) ? numeric : 0}
              onChange={(event) => apply(event.target.value)}
              aria-label={def.key}
            />
            {textInput}
          </span>
        </label>
      );
    }
    if (def.editor === "textarea") {
      return (
        <label key={def.key} className={styles.wideField}>
          <span>{def.key}</span>
          <textarea
            rows={2}
            value={draft ?? current}
            onChange={(event) => setStyleDraft(def.key, event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commit(); } if (event.key === "Escape") clearStyleDraft(def.key); }}
            onBlur={commit}
          />
        </label>
      );
    }
    if (def.editor === "unit" && def.units) {
      const parsed = parseUnitValue(draft ?? current, def.units);
      if (parsed) {
        const unitOptions = def.units.filter((u) => u !== "" || def.units!.length === 1);
        return (
          <label key={def.key}>
            <span>{def.key}</span>
            <span className={styles.unitField}>
              <input
                inputMode="decimal"
                value={parsed.number}
                onChange={(event) => setStyleDraft(def.key, `${event.target.value}${parsed.unit}`.trim())}
                onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") clearStyleDraft(def.key); }}
                onBlur={commit}
              />
              <select
                value={parsed.unit}
                onChange={(event) => apply(`${parsed.number}${event.target.value}`)}
              >
                {(def.units.length > 1 ? ["", ...unitOptions] : [""]).map((unit) => (
                  <option key={unit} value={unit}>{unit === "" ? "—" : unit}</option>
                ))}
              </select>
            </span>
          </label>
        );
      }
      return (
        <label key={def.key}>
          <span>{def.key}</span>
          {textInput}
        </label>
      );
    }
    return (
      <label key={def.key}>
        <span>{def.key}</span>
        {textInput}
      </label>
    );
  };

  const styleGroups = Object.keys(PROPERTY_GROUP_LABEL_KEYS) as (keyof typeof PROPERTY_GROUP_LABEL_KEYS)[];
  const attributeDefs = selected ? attributeDefinitionsForTag(selected.tag) : [];
  const coveredAttributes = new Set(attributeDefs.map((def) => def.name));
  const extraAttributeNames = selected
    ? EDITABLE_ATTRIBUTES.filter((name) => !coveredAttributes.has(name) && name in (selected.attributes ?? {}))
    : [];

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
                  if (event.key === "Escape") setTextDraft(null);
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
            {classes.length > 0 && (
              <div className={styles.classChips}>
                {classes.map((name, index) => (
                  <span key={`${name}-${index}`} className={styles.classChip}>
                    <code>{name}</code>
                    <button type="button" title={t("inspector.removeClass")} onClick={() => removeClass(index)}>x</button>
                  </span>
                ))}
              </div>
            )}
            <input
              className={styles.classInput}
              value={classDraft ?? ""}
              placeholder={t("inspector.classesPlaceholder")}
              onChange={(event) => setClassDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && classDraft !== null) { addClass(classDraft); setClassDraft(null); }
                if (event.key === "Escape") setClassDraft(null);
              }}
            />
            <button className={styles.inlineAction} type="button" disabled={classDraft === null || !classDraft.trim()} onClick={() => {
              if (classDraft !== null) addClass(classDraft);
              setClassDraft(null);
            }}>{t("inspector.addClass")}</button>
            {selected.tailwind && <p className={styles.note}>{t("inspector.tailwind")}</p>}
          </section>

          <section className={styles.section}>
            <h3>{t("inspector.attributes")}</h3>
            <div className={styles.editor}>
              {attributeDefs.map((def) => renderAttributeEditor(def.name, def))}
              {extraAttributeNames.map((name) => renderAttributeEditor(name, undefined))}
            </div>
          </section>

          <section className={styles.section}>
            <h3>{t("inspector.structure")}</h3>
            <div className={styles.actions}>
              {BLOCK_OPS.map(({ op, key }) => <button key={op} type="button" onClick={() => onApplyOp(op)}>{t(key)}</button>)}
            </div>
          </section>

          <section className={styles.section}>
            <h3>{t("inspector.styles")}</h3>
            {styleGroups.map((group) => {
              const defs = PROPERTY_DEFINITIONS.filter((def) => def.group === group);
              if (defs.length === 0) return null;
              return (
                <div key={group} className={styles.styleGroup}>
                  <h4>{t(PROPERTY_GROUP_LABEL_KEYS[group])}</h4>
                  <div className={styles.editor}>
                    {defs.map(renderStyleControl)}
                  </div>
                </div>
              );
            })}
            <p className={styles.note}>{t("inspector.stylesNote")}</p>
          </section>
        </div>
      ) : (
        <p className={styles.empty}>{t("inspector.empty")}</p>
      )}
    </aside>
  );
}
