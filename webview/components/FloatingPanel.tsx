import React, { useEffect, useState } from "react";
import styles from "./FloatingPanel.module.css";
import { translate, type Language } from "@design-studio/shared/i18n";
import { Icon } from "./Icon";

const TOAST_MS = 2600;

/** Transient toast notifications for operation results (replaces the old status strip). */
export function FloatingPanel({
  status,
  seq,
  language,
  onDismiss,
}: {
  status: string;
  seq: number;
  language: Language;
  onDismiss: () => void;
}): React.ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!status) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [status, seq, onDismiss]);

  if (!status || !visible) return null;
  return (
    <div className={styles.toast} role="status" aria-label={translate(language, "status.aria")}>
      <span className={styles.toastIcon}><Icon name="check" /></span>
      <span className={styles.toastText}>{status}</span>
      <button
        type="button"
        className={styles.toastClose}
        aria-label={translate(language, "status.dismiss")}
        onClick={onDismiss}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}