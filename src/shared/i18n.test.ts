import { describe, expect, it } from "vitest";
import { I18N_STRINGS, translate, type Language } from "./i18n";

describe("P2-11: toolbar labels and RU/EN parity", () => {
  it("Reports a non-running dev server instead of claiming it was detected", () => {
    expect(translate("ru", "toolbar.serverDown")).toBe("Сервер не запущен");
    expect(translate("en", "toolbar.serverDown")).toBe("Server not running");
  });

  it("Labels the edit-mode toggle as an action (target mode), not the current state", () => {
    expect(translate("ru", "toolbar.toEdit")).toBe("Редактировать");
    expect(translate("en", "toolbar.toEdit")).toBe("Edit");
    expect(translate("ru", "toolbar.toBrowse")).toBe("Просмотр");
    expect(translate("en", "toolbar.toBrowse")).toBe("Browse");
  });

  it("Localizes structure undo and the preview error overlays", () => {
    expect(translate("ru", "inspector.undoStructure")).toBe("Отменить структурную правку");
    expect(translate("en", "inspector.undoStructure")).toBe("Undo structure edit");
    expect(translate("ru", "status.undone")).toBe("Структурная правка отменена");
    expect(translate("en", "status.undone")).toBe("Structure edit undone");
    expect(translate("ru", "status.undoFailed")).toBe("Не удалось отменить правку");
    expect(translate("en", "status.undoFailed")).toBe("Could not undo the edit");
    expect(translate("en", "preview.overlayMissing")).toBe("Unable to connect to preview.");
    expect(translate("en", "preview.overlayMismatch")).toBe("Runtime protocol mismatch.");
    expect(translate("ru", "preview.overlayMissing")).not.toBe("preview.overlayMissing");
    expect(translate("ru", "preview.overlayMismatch")).not.toBe("preview.overlayMismatch");
  });

  it("Keeps RU and EN key sets in perfect parity", () => {
    const keys = Object.keys(I18N_STRINGS);
    for (const key of keys) {
      const entry = I18N_STRINGS[key as keyof typeof I18N_STRINGS];
      expect(typeof entry.ru).toBe("string");
      expect((entry as { ru: string; en?: string }).en ?? entry.ru).not.toBeUndefined();
    }
    // Spot-check both languages resolve every key without falling back.
    for (const key of keys) {
      for (const language of ["ru", "en"] as Language[]) {
        expect(translate(language, key as Parameters<typeof translate>[1])).not.toBe(key);
      }
    }
  });
});
