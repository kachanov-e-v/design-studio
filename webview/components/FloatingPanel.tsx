import React, { useState } from "react";
import styles from "./FloatingPanel.module.css";
import type { ElementPayload } from "../types";
import type { DesignEdit } from "../../src/domain/entities/DesignEdit";
import { translate, type Language } from "@design-studio/shared/i18n";

export function FloatingPanel({
  selected,
  status,
  edits,
  language,
  onCopyInstruction,
}: {
  selected: ElementPayload | null;
  status: string;
  edits: DesignEdit[];
  language: Language;
  onCopyInstruction: (instruction: string) => void;
}): React.ReactElement {
  const [instruction, setInstruction] = useState("");
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);

  return (
    <div className={styles.panel} role="group" aria-label={t("floating.aria")}>
      <input
        className={styles.input}
        placeholder={t("floating.instruction")}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && selected) onCopyInstruction(instruction); }}
      />
      <button className={styles.copyButton} type="button" disabled={!selected} onClick={() => onCopyInstruction(instruction)}>
        {t("floating.copyInstruction")}
      </button>
      <span className={styles.count}>{t("floating.edits")}: {edits.length}</span>
      {status && <span className={styles.status} role="status">{status}</span>}
    </div>
  );
}
