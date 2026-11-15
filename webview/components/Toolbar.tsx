import React, { useState } from "react";
import styles from "./Toolbar.module.css";
import { postToExtension } from "../bridge";

export function Toolbar({
  projectRoot,
  projectEntry,
  projectEntries,
  devServer,
  editMode,
  onInspect,
  onSave,
  canSave,
}: {
  projectRoot?: string | null;
  projectEntry?: string;
  projectEntries?: string[];
  devServer?: string;
  editMode: boolean;
  onInspect: () => void;
  onSave: () => void;
  canSave?: boolean;
}): React.ReactElement {
  const [devServerValue, setDevServerValue] = useState(devServer ?? "");
  const [showDevServer, setShowDevServer] = useState(Boolean(devServer));

  const handleEntryChange = (value: string) => {
    if (value === "__devserver") {
      setShowDevServer(true);
      return;
    }
    if (value === "__demo") {
      postToExtension({ type: "preview:demo" });
      return;
    }
    if (value) postToExtension({ type: "project:setEntry", path: value });
  };

  const handleDevServerSubmit = () => {
    postToExtension({ type: "project:setDevServer", url: devServerValue.trim() });
  };

  return (
    <header className={styles.toolbar} role="toolbar" aria-label="Design Studio toolbar">
      <span className={styles.title}>Design Studio</span>
      {projectRoot ? (
        <div className={styles.urlBar}>
          <label className={styles.entryLabel}>
            Project
            <select
              value={showDevServer ? "__devserver" : projectEntry ?? ""}
              onChange={(e) => handleEntryChange(e.target.value)}
              aria-label="Bound project page"
            >
              {showDevServer && <option value="__devserver">Dev server: {devServerValue || "…"}</option>}
              <option value="__demo">Built-in Demo</option>
              {(projectEntries ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          {showDevServer ? (
            <>
              <input
                type="url"
                placeholder="http://localhost:5173 (project dev server)"
                value={devServerValue}
                onChange={(e) => setDevServerValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleDevServerSubmit();
                }}
              />
              <button type="button" onClick={handleDevServerSubmit}>Use</button>
              <button type="button" onClick={() => setShowDevServer(false)}>Files</button>
            </>
          ) : (
            <button type="button" onClick={() => setShowDevServer(true)}>Dev server…</button>
          )}
        </div>
      ) : (
        <span className={styles.error}>Open a project folder to bind Design Studio</span>
      )}
      <nav className={styles.actions}>
        <button type="button" onClick={onInspect} aria-pressed={editMode} title="Toggle edit mode (hover, click, double-click to edit text)">
          {editMode ? "Edit: On" : "Edit"}
        </button>
        <button type="button" onClick={onSave} disabled={!canSave} title="Save pending changes to source and journal">Save</button>
      </nav>
    </header>
  );
}
