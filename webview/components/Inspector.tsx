import React, { useEffect, useRef, useState } from "react";
import styles from "./Inspector.module.css";
import { EDITABLE_ATTRIBUTES } from "@design-studio/preview-runtime/protocol";
import type { EditableAttribute, ElementOp, ElementPayload } from "../types";
import type { DesignEdit } from "../../src/domain/entities/DesignEdit";
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
  instruction,
  onInstructionChange,
  edits,
  onCopyInstruction,
  onUndoStructure,
}: {
  selected: ElementPayload | null;
  onApplyStyle: (property: string, value: string) => void;
  onApplyOp: (op: ElementOp, value?: string, attribute?: EditableAttribute) => void;
  onEditText: (text: string) => void;
  onCopyComponent: (component: { name?: string; file?: string; line?: number }) => void;
  language: Language;
  error?: string;
  instruction: string;
  onInstructionChange: (value: string) => void;
  edits: DesignEdit[];
  onCopyInstruction: (instruction: string) => void;
  onUndoStructure?: (requestId: string) => void;
}): React.ReactElement {
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState<string | null>(null);
  const [styleDrafts, setStyleDrafts] = useState<Record<string, string>>({});
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ instruction: true });
  const toggleSection = (id: string) => setOpenSections((previous) => ({ ...previous, [id]: !previous[id] }));
  const autoSizeTextarea = (node: HTMLTextAreaElement | null) => {
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(160, Math.max(26, node.scrollHeight))}px`;
  };
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const classes = selected?.classes ?? [];
  const setAttributeDraft = (name: string, value: string) => setAttributeDrafts((p) => ({ ...p, [name]: value }));
  const clearAttributeDraft = (name: string) => setAttributeDrafts((p) => {
    const next = { ...p };
    delete next[name];
    return next;
  });
  const setStyleDraft = (key: string, value: string) => setStyleDrafts((p) => ({ ...p, [key]: value }));

  // P2-5: slider/color controls apply continuously while dragged. A debounce
  // (~100 ms) collapses the gesture into one live apply; the final commit
  // happens on release (pointerUp / blur), and the journal merges the rest.
  const previewTimers = useRef<Record<string, number>>({});
  const selectorRef = useRef(selected?.selector);
  selectorRef.current = selected?.selector;
  const preview = (key: string, value: string) => {
    setStyleDraft(key, value);
    const selector = selectorRef.current;
    window.clearTimeout(previewTimers.current[key]);
    previewTimers.current[key] = window.setTimeout(() => {
      delete previewTimers.current[key];
      // A stale debounce must never apply to a different selected element.
      if (selectorRef.current !== selector) return;
      onApplyStyle(key, value);
    }, 100);
  };
  useEffect(() => () => {
    for (const timer of Object.values(previewTimers.current)) window.clearTimeout(timer);
    previewTimers.current = {};
  }, []);
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
    for (const timer of Object.values(previewTimers.current)) window.clearTimeout(timer);
    previewTimers.current = {};
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
          <span title={name}>{name}</span>
          <input type="checkbox" checked={present} onChange={(event) => apply(event.target.checked ? "true" : "")} />
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
            rows={1}
            ref={autoSizeTextarea}
            value={draft ?? current}
            onChange={(event) => { setAttributeDraft(name, event.target.value); autoSizeTextarea(event.currentTarget); }}
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
            {hex && (
              <input
                type="color"
                value={hex}
                onChange={(event) => preview(def.key, event.target.value)}
                onBlur={commit}
                aria-label={def.key}
              />
            )}
            {textInput}
          </span>
        </label>
      );
    }
    if (def.editor === "slider") {
      const shown = draft ?? current;
      const numeric = Number.parseFloat(shown);
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
              onChange={(event) => preview(def.key, event.target.value)}
              onPointerUp={commit}
              onKeyUp={commit}
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
            rows={1}
            ref={autoSizeTextarea}
            value={draft ?? current}
            onChange={(event) => { setStyleDraft(def.key, event.target.value); autoSizeTextarea(event.currentTarget); }}
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

  const canCopyInstruction = Boolean(selected || instruction.trim() || edits.length > 0);
  const describeEdit = (edit: DesignEdit): string => {
    const pair = (before?: string, after?: string) => `${before || "—"} → ${after || "—"}`;
    if (edit.kind === "comment") return `${t("edits.comment")}: ${edit.after ?? ""}`;
    if (edit.kind === "style") return `${edit.property ?? ""}: ${pair(edit.before, edit.after)}`;
    if (edit.kind === "text") return `${t("inspector.text")}: ${pair(edit.before, edit.after)}`;
    if (edit.kind === "classes") return `${t("inspector.classes")}: ${pair(edit.before, edit.after)}`;
    if (edit.kind === "attribute") {
      return edit.after
        ? `${t("edits.attribute")} ${edit.property ?? ""}: ${pair(edit.before, edit.after)}`
        : `${t("edits.attribute")} ${edit.property ?? ""}: ${t("edits.removed")}`;
    }
    return `${t("inspector.structure")}: ${edit.operation ?? ""}`;
  };
  const editGroups: { selector: string; name?: string; items: DesignEdit[] }[] = [];
  for (const edit of edits) {
    const group = editGroups.find((candidate) => candidate.selector === edit.selector);
    if (group) group.items.push(edit);
    else editGroups.push({ selector: edit.selector, name: edit.component?.name, items: [edit] });
  }
  // Plain render helper (NOT a nested component): keeps the DOM stable so
  // inputs inside sections do not remount/lose focus on every render.
  const renderSection = (id: string, title: string, content: React.ReactNode, badge?: React.ReactNode) => {
    const open = Boolean(openSections[id]);
    return (
      <section className={styles.section} key={id}>
        <button type="button" className={styles.sectionHeader} aria-expanded={open} onClick={() => toggleSection(id)}>
          <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true">▸</span>
          <span className={styles.sectionTitle}>{title}</span>
          {badge}
        </button>
        {open && <div className={styles.sectionBody}>{content}</div>}
      </section>
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
      <div className={styles.body}>
        {renderSection(
          "instruction",
          t("inspector.instruction"),
          <>
            <textarea
              className={styles.instructionInput}
              rows={2}
              ref={autoSizeTextarea}
              value={instruction}
              placeholder={t("floating.instruction")}
              onChange={(event) => { onInstructionChange(event.target.value); autoSizeTextarea(event.currentTarget); }}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canCopyInstruction) onCopyInstruction(instruction); }}
            />
            {editGroups.length > 0 ? (
              <div className={styles.editGroups}>
                {editGroups.map((group) => (
                  <div key={group.selector} className={styles.editGroup}>
                    <div className={styles.editGroupTitle} title={group.selector}>{group.name ?? group.selector}</div>
                    <ul className={styles.editList}>
                      {group.items.map((edit, index) => {
                        const description = describeEdit(edit);
                        const undoRequestId = edit.kind === "structure" ? edit.requestId : undefined;
                        return (
                          <li key={index} title={description}>
                            {description}
                            {undoRequestId && onUndoStructure && (
                              <button
                                type="button"
                                className={styles.undoEdit}
                                title={t("inspector.undoStructure")}
                                aria-label={t("inspector.undoStructure")}
                                onClick={() => onUndoStructure(undoRequestId)}
                              >
                                ↩
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.note}>{t("inspector.editsNone")}</p>
            )}
            <button
              type="button"
              className={styles.copyInstruction}
              disabled={!canCopyInstruction}
              onClick={() => onCopyInstruction(instruction)}
            >
              {t("floating.copyInstruction")}
            </button>
          </>,
          edits.length > 0 ? <span className={styles.sectionBadge}>{edits.length}</span> : undefined
        )}
        {selected ? (
          <>
            <div className={styles.identity}>
              <div><span>{t("inspector.tag")}</span><b>{selected.tag}</b></div>
              <div title={selected.selector}><span>{t("inspector.selector")}</span><code>{selected.selector}</code></div>
            </div>

            {selected.component?.length
              ? renderSection("component", t("inspector.component"), (
                  <div className={styles.componentList}>
                    {selected.component.map((component, index) => (
                      <div className={styles.component} key={`${component.name ?? "component"}-${component.file ?? index}-${index}`}>
                        <div className={styles.componentInfo}>
                          <strong>{component.name ?? (language === "ru" ? "Компонент React" : "React component")}</strong>
                          <code title={component.file}>{component.file ? `${component.file}${component.line ? `:${component.line}` : ""}` : t("inspector.noSource")}</code>
                        </div>
                        <button type="button" disabled={!component.file && !component.name} onClick={() => onCopyComponent(component)} title={t("inspector.copySource")}>
                          {t("inspector.copySource")}
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              : null}

            {renderSection("text", t("inspector.text"), (
              <>
                <div className={styles.row}>
                  <input
                    value={textDraft ?? selected.text ?? ""}
                    placeholder={t("inspector.noText")}
                    onChange={(event) => setTextDraft(event.target.value)}
                    onBlur={() => {
                      // P2-18: the text field commits on blur, as the README promises.
                      if (textDraft !== null && textDraft !== (selected.text ?? "")) {
                        onEditText(textDraft);
                        setTextDraft(null);
                      }
                    }}
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
                <p className={styles.note}>{t("inspector.textOwnNote")}</p>
              </>
            ))}

            {renderSection("classes", t("inspector.classes"), (
              <>
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
              </>
            ))}

            {renderSection("attributes", t("inspector.attributes"), (
              <div className={styles.editor}>
                {attributeDefs.map((def) => renderAttributeEditor(def.name, def))}
                {extraAttributeNames.map((name) => renderAttributeEditor(name, undefined))}
              </div>
            ))}

            {renderSection("structure", t("inspector.structure"), (
              <div className={styles.actions}>
                {BLOCK_OPS.map(({ op, key }) => <button key={op} type="button" onClick={() => onApplyOp(op)}>{t(key)}</button>)}
              </div>
            ))}

            {renderSection("styles", t("inspector.styles"), (
              <>
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
              </>
            ))}
          </>
        ) : (
          <p className={styles.empty}>{t("inspector.empty")}</p>
        )}
      </div>
    </aside>
  );
}
