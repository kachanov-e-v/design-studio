import React, { useLayoutEffect, useRef, useState } from "react";
import styles from "./SelectionPopup.module.css";
import { translate, type Language } from "@design-studio/shared/i18n";

export interface SelectionPopupTarget {
  rect: { top: number; left: number; width: number; height: number };
  components: { name?: string; file?: string; line?: number }[] | undefined;
}

export interface SelectionPopupProps {
  target: SelectionPopupTarget;
  language: Language;
  onReveal: (components: { name?: string; file?: string; line?: number }[]) => void;
  onCopyInstruction: (instruction: string) => void;
  onClose?: () => void;
}

const MARGIN = 8;

/**
 * Compact popup anchored to the selected element inside the preview frame.
 * Popup coordinates come from the runtime payload, whose origin matches the
 * iframe viewport and therefore the absolutely positioned popup parent
 * (the `.frame` wrapper, which fully contains the iframe).
 */
export const SelectionPopup = function SelectionPopup({
  target,
  language,
  onReveal,
  onCopyInstruction,
  onClose,
}: SelectionPopupProps): React.ReactElement {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupSize, setPopupSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    setPopupSize((current) =>
      current && Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1
        ? current
        : { width: rect.width, height: rect.height }
    );
  });

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

  const componentName =
    target.components?.find((comp) => comp.name)?.name ?? translate(language, "popup.unnamedElement");

  const autoGrow = (node: HTMLTextAreaElement | null) => {
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(120, node.scrollHeight)}px`;
  };

  const submit = () => {
    const instruction = (popupRef.current?.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "";
    onCopyInstruction(instruction.trim());
  };

  return (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left, top }}
      role="dialog"
      aria-label={componentName}
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
        className={styles.input}
        placeholder={translate(language, "popup.placeholder")}
        rows={1}
        onInput={(event) => autoGrow(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.currentTarget.blur(); onClose?.(); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
        }}
      />
      <button type="button" className={styles.copyButton} onClick={submit}>
        {translate(language, "popup.copyForAi")}
      </button>
    </div>
  );
};
