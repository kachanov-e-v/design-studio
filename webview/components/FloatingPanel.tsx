import React from "react";
import styles from "./FloatingPanel.module.css";
import { translate, type Language } from "@design-studio/shared/i18n";

/**
 * The instruction input and the copy button moved into the Inspector
 * ("Инструкция" section). This panel is now a slim status strip only.
 */
export function FloatingPanel({ status, language }: { status: string; language: Language }): React.ReactElement | null {
  if (!status) return null;
  return (
    <div className={styles.statusBar} role="status" aria-label={translate(language, "status.aria")}>
      {status}
    </div>
  );
}
