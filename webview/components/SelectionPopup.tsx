import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./SelectionPopup.module.css";
import { translate, type Language } from "@design-studio/shared/i18n";
import { primaryComponent } from "../componentInfo";

export interface SelectionPopupTarget {
  selector: string;
  rect: { top: number; left: number; width: number; height: number };
  components: { name?: string; file?: string; line?: number }[] | undefined;
}

export interface SelectionPopupProps {
  target: SelectionPopupTarget;
  language: Language;
  draft: string;
  onDraftChange: (value: string) => void;
  onReveal: (components: { name?: string; file?: string; line?: number }[]) => void;
  onCopyInstruction: (instruction: string) => void;
  onAddToInstruction?: (instruction: string) => void;
  onClose?: () => void;
}

const MARGIN = 8;
const FLASH_MS = 1600;

/**
 * Compact popup anchored to the selected element inside the preview frame.
 * The draft is controlled by the App journal (keyed by selector), so switching
 * elements never leaks the previous element's text and returning restores it.
 */
export const SelectionPopup = function SelectionPopup({
  target,
  language,
  draft,
  onDraftChange,
  onReveal,
  onCopyInstruction,
  onAddToInstruction,
  onClose,
}: SelectionPopupProps): React.ReactElement {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [popupSize, setPopupSize] = useState<{ width: number; height: number } | null>(null);
  const [flash, setFlash] = useState<"copied" | "added" | null>(null);

  // Same priority as "Reveal": nearest component with a workspace source file,
  // so the popup title matches the file the button actually opens.
  const componentName = primaryComponent(target.components)?.name ?? translate(language, "popup.unnamedElement");

  const autoGrow = (node: HTMLTextAreaElement | null) => {
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(120, Math.max(24, node.scrollHeight))}px`;
  };

  const setInputRef = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
    autoGrow(node);
  }, []);

  // Typing grows the textarea in onChange; this only catches external draft
  // changes (restore on element switch, clear after adding a comment).
  const lastDraftRef = useRef(draft);
  useLayoutEffect(() => {
    if (lastDraftRef.current !== draft) {
      lastDraftRef.current = draft;
      autoGrow(inputRef.current);
    }
    const popup = popupRef.current;
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    setPopupSize((current) =>
      current && Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1
        ? current
        : { width: rect.width, height: rect.height }
    );
  }, [draft, flash, language, target.selector, componentName]);

  useEffect(() => {
    setFlash(null);
    inputRef.current?.focus();
  }, [target.selector]);

  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  }, []);

  const showFlash = (kind: "copied" | "added") => {
    setFlash(kind);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  const parent = popupSize ? popupRef.current?.offsetParent : null;
  let left = target.rect.left;
  let top = target.rect.top + target.rect.height + MARGIN;
  if (popupSize && parent instanceof HTMLElement) {
    const frameWidth = parent.offsetWidth;
    const frameHeight = parent.offsetHeight;
    const maxLeft = Math.max(MARGIN, frameWidth - popupSize.width - MARGIN);
    left = Math.min(Math.max(MARGIN, left), maxLeft);
    const below = top;
    const above = target.rect.top - popupSize.height - MARGIN;
    top = below + popupSize.height <= frameHeight - MARGIN || above < MARGIN
      ? Math.min(below, Math.max(MARGIN, frameHeight - popupSize.height - MARGIN))
      : Math.max(MARGIN, above);
  }

  const submit = () => {
    onCopyInstruction(draft.trim());
    showFlash("copied");
  };

  const addToInstruction = () => {
    const text = draft.trim();
    if (!text || !onAddToInstruction) return;
    onAddToInstruction(text);
    showFlash("added");
  };

  return (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left, top }}
      role="dialog"
      aria-label={componentName}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose?.();
      }}
    >
      <div className={styles.header}>
        <span className={styles.component} title={componentName}>{componentName}</span>
        <button
          type="button"
          className={styles.goButton}
          onClick={() => onReveal(target.components ?? [])}
        >
          {translate(language, "popup.goTo")}
        </button>
        {onClose && (
          <button
            type="button"
            className={styles.goButton}
            aria-label={translate(language, "popup.close")}
            title={translate(language, "popup.close")}
            onClick={onClose}
          >
            x
          </button>
        )}
      </div>
      <textarea
        ref={setInputRef}
        className={styles.input}
        placeholder={translate(language, "popup.placeholder")}
        rows={1}
        value={draft}
        onChange={(event) => {
          lastDraftRef.current = event.target.value;
          onDraftChange(event.target.value);
          autoGrow(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
        }}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.addButton} ${flash === "added" ? styles.success : ""}`}
          disabled={!draft.trim() || !onAddToInstruction}
          onClick={addToInstruction}
        >
          {flash === "added" ? translate(language, "popup.added") : translate(language, "popup.addToInstruction")}
        </button>
        <button
          type="button"
          className={`${styles.copyButton} ${flash === "copied" ? styles.success : ""}`}
          onClick={submit}
        >
          {flash === "copied" ? translate(language, "popup.copied") : translate(language, "popup.copyForAi")}
        </button>
      </div>
    </div>
  );
};
