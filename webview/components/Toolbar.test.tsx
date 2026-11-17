// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toolbar } from "./Toolbar";

afterEach(cleanup);

function renderToolbar(editMode: boolean, onSetMode = vi.fn()) {
  render(
    <Toolbar
      editMode={editMode}
      language="ru"
      onLanguageChange={vi.fn()}
      onSetMode={onSetMode}
      onSave={vi.fn()}
    />
  );
  return onSetMode;
}

describe("Toolbar segmented mode switch", () => {
  it("shows both modes with aria-pressed on the current one", () => {
    renderToolbar(false);
    expect(screen.getByRole("button", { name: "Просмотр" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Редактировать" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("requests the target mode when the other segment is clicked", () => {
    const onSetMode = renderToolbar(false);
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    expect(onSetMode).toHaveBeenCalledWith(true);
  });

  it("marks Edit active in edit mode and Browse returns to browse", () => {
    const onSetMode = renderToolbar(true);
    expect(screen.getByRole("button", { name: "Редактировать" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Просмотр" }));
    expect(onSetMode).toHaveBeenCalledWith(false);
  });
});