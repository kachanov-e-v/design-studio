import React, { useState } from "react";
import styles from "./Toolbar.module.css";
import { postToExtension } from "../bridge";

export function Toolbar({ onSetUrl, currentUrl }: { onSetUrl: (url: string) => void; currentUrl: string }): React.ReactElement {
  const [value, setValue] = useState(currentUrl);

  return (
    <header className={styles.toolbar} role="toolbar" aria-label="Design Studio toolbar">
      <span className={styles.title}>Design Studio</span>
      <div className={styles.urlBar}>
        <input
          type="url"
          placeholder="Preview URL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSetUrl(value);
          }}
        />
        <button type="button" onClick={() => onSetUrl(value)}>Load</button>
      </div>
      <nav className={styles.actions}>
        <button type="button" onClick={() => postToExtension({ type: "preview:demo" })}>Demo</button>
        <button type="button">Inspect</button>
        <button type="button">Save</button>
      </nav>
    </header>
  );
}