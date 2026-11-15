import React, { useState } from "react";
import styles from "./Toolbar.module.css";
import { postToExtension } from "../bridge";
import type { DevServerSuggestion } from "../types";
import { translate, type Language } from "@design-studio/shared/i18n";

export function Toolbar({
  projectRoot,
  projectEntry,
  projectEntries,
  devServer,
  devServerSuggestions,
  editMode,
  language,
  onLanguageChange,
  onInspect,
  onSave,
  canSave,
}: {
  projectRoot?: string | null;
  projectEntry?: string;
  projectEntries?: string[];
  devServer?: string;
  devServerSuggestions?: DevServerSuggestion[];
  editMode: boolean;
  language: Language;
  onLanguageChange: (language: Language) => void;
  onInspect: () => void;
  onSave: () => void;
  canSave?: boolean;
}): React.ReactElement {
  const [devServerValue, setDevServerValue] = useState(devServer ?? "");
  const [showDevServer, setShowDevServer] = useState(Boolean(devServer));
  const suggestions = devServerSuggestions ?? [];
  const suggested = suggestions.find((candidate) => candidate.running) ?? suggestions[0] ?? null;
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);

  const suggestLabel = (candidate: DevServerSuggestion): string => {
    if (candidate.matchesProject === false) return `${candidate.url} · ${t("toolbar.serverOther")}`;
    if (candidate.kind === "next") return `${candidate.url} · ${t("toolbar.detectedNext")}`;
    if (candidate.kind === "vite") return `${candidate.url} · ${t("toolbar.detectedVite")}`;
    if (candidate.kind !== "unknown" && candidate.kind !== "static-http") return `${candidate.url} · ${t("toolbar.detectedServer")}`;
    if (candidate.running) return `${candidate.url} · ${t("toolbar.serverUnknown")}`;
    return `${candidate.url} · ${t("toolbar.serverDown")}`;
  };

  const handleEntryChange = (value: string) => {
    if (value === "__devserver") {
      setShowDevServer(true);
      setDevServerValue((current) => current || suggested?.url || "http://localhost:3000");
      return;
    }
    if (value.startsWith("__suggest:")) {
      const url = value.slice("__suggest:".length);
      setDevServerValue(url);
      setShowDevServer(true);
      postToExtension({ type: "project:setDevServer", url });
      return;
    }
    if (value === "__demo") {
      setShowDevServer(false);
      postToExtension({ type: "preview:demo" });
      return;
    }
    if (value) {
      setShowDevServer(false);
      postToExtension({ type: "project:setEntry", path: value });
    }
  };

  const handleDevServerSubmit = () => {
    postToExtension({ type: "project:setDevServer", url: devServerValue.trim() });
  };

  return (
    <header className={styles.toolbar} role="toolbar" aria-label={t("toolbar.aria")}>
      <div className={styles.brand}>{t("toolbar.title")}</div>
      <div className={styles.project}>
        <label className={styles.entryLabel}>
          <span>{t("toolbar.project")}</span>
          <select
            value={showDevServer ? "__devserver" : projectEntry ?? ""}
            onChange={(event) => handleEntryChange(event.target.value)}
            aria-label={t("toolbar.projectPage")}
          >
            {showDevServer && <option value="__devserver">{devServerValue || "Next.js"}</option>}
            <option value="__demo">{t("toolbar.demo")}</option>
            {suggested && !showDevServer && <option value={`__suggest:${suggested.url}`}>{suggestLabel(suggested)}</option>}
            {(projectEntries ?? []).map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        {showDevServer ? (
          <>
            <input
              className={styles.serverInput}
              type="url"
              placeholder={t("toolbar.serverPlaceholder")}
              value={devServerValue}
              onChange={(event) => setDevServerValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") handleDevServerSubmit(); }}
            />
            <button type="button" onClick={handleDevServerSubmit}>{t("toolbar.useServer")}</button>
            {(projectEntries?.length ?? 0) > 0 && <button className={styles.quiet} type="button" onClick={() => setShowDevServer(false)}>{t("toolbar.files")}</button>}
          </>
        ) : (
          <button className={styles.quiet} type="button" onClick={() => handleEntryChange("__devserver")}>{t("toolbar.server")}</button>
        )}
        {!projectRoot && <span className={styles.projectMissing}>{t("toolbar.projectMissing")}</span>}
      </div>
      <nav className={styles.actions} aria-label={t("toolbar.aria")}>
        <button className={editMode ? styles.active : styles.quiet} type="button" onClick={onInspect} aria-pressed={editMode}>
          {editMode ? t("toolbar.editOn") : t("toolbar.edit")}
        </button>
        <button className={styles.quiet} type="button" onClick={onSave} disabled={!canSave}>{t("toolbar.save")}</button>
        <div className={styles.language} role="group" aria-label={t("toolbar.language")}>
          <button type="button" className={language === "ru" ? styles.languageActive : ""} onClick={() => onLanguageChange("ru")}>RU</button>
          <button type="button" className={language === "en" ? styles.languageActive : ""} onClick={() => onLanguageChange("en")}>EN</button>
        </div>
      </nav>
    </header>
  );
}
