import React, { useEffect, useRef, useState } from "react";
import styles from "./Toolbar.module.css";
import { postToExtension } from "../bridge";
import { isAllowedUrl } from "../../src/shared/url";

export function Toolbar({
  onSetUrl,
  currentUrl,
  editMode,
  onInspect,
  onSave,
  canSave,
}: {
  onSetUrl: (url: string) => void;
  currentUrl: string;
  editMode: boolean;
  onInspect: () => void;
  onSave: () => void;
  canSave?: boolean;
}): React.ReactElement {
  const [value, setValue] = useState(currentUrl);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setValue(currentUrl);
    }
  }, [currentUrl]);

  const handleLoad = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a URL");
      return;
    }
    if (!isAllowedUrl(trimmed)) {
      setError("Invalid URL (http/https only)");
      return;
    }
    setError("");
    onSetUrl(trimmed);
  };

  return (
    <header className={styles.toolbar} role="toolbar" aria-label="Design Studio toolbar">
      <span className={styles.title}>Design Studio</span>
      <div className={styles.urlBar}>
        <input
          ref={inputRef}
          type="url"
          placeholder="Preview URL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLoad();
          }}
        />
        <button type="button" onClick={handleLoad}>Load</button>
        {error && <span className={styles.error}>{error}</span>}
      </div>
      <nav className={styles.actions}>
        <button type="button" onClick={() => postToExtension({ type: "preview:demo" })}>Demo</button>
        <button type="button" onClick={onInspect} aria-pressed={editMode} title="Toggle edit mode">
          {editMode ? "Inspect: On" : "Inspect"}
        </button>
        <button type="button" onClick={onSave} disabled={!canSave} title="Save last style change to source">Save</button>
      </nav>
    </header>
  );
}
