// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SelectionPopup } from "./SelectionPopup";

afterEach(cleanup);

const target = {
  selector: "div#card",
  rect: { top: 4, left: 4, width: 10, height: 10 },
  components: [],
};

function renderPopup(extra: { draft?: string; onAddToInstruction?: (v: string) => void; onClose?: () => void } = {}) {
  return render(
    <SelectionPopup
      target={target}
      language="ru"
      draft={extra.draft ?? ""}
      onDraftChange={vi.fn()}
      onReveal={vi.fn()}
      onCopyInstruction={vi.fn()}
      onAddToInstruction={extra.onAddToInstruction ?? vi.fn()}
      onClose={extra.onClose}
    />
  );
}

describe("SelectionPopup close (P2-6)", () => {
  it("renders a close button and calls onClose", () => {
    const onClose = vi.fn();
    renderPopup({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed anywhere in the popup", () => {
    const onClose = vi.fn();
    renderPopup({ onClose });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionPopup focus", () => {
  it("focuses the textarea on mount and when the target selector changes", () => {
    const props = {
      target,
      language: "ru" as const,
      draft: "",
      onDraftChange: vi.fn(),
      onReveal: vi.fn(),
      onCopyInstruction: vi.fn(),
      onAddToInstruction: vi.fn(),
    };
    const { rerender } = render(<SelectionPopup {...props} />);
    const textarea = screen.getByPlaceholderText("Что изменить в этом элементе");
    expect(document.activeElement).toBe(textarea);

    (screen.getByRole("button", { name: "Перейти" }) as HTMLButtonElement).focus();
    rerender(<SelectionPopup {...props} target={{ ...target, selector: "div#other" }} />);
    expect(document.activeElement).toBe(textarea);
  });
});

describe("SelectionPopup shared instruction", () => {
  it("disables the add button while the draft is empty", () => {
    renderPopup();
    const button = screen.getByRole("button", { name: "Добавить в общую инструкцию" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("sends the draft to the shared instruction and confirms visually", () => {
    const onAddToInstruction = vi.fn();
    renderPopup({ draft: "Добавить тень", onAddToInstruction });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в общую инструкцию" }));
    expect(onAddToInstruction).toHaveBeenCalledWith("Добавить тень");
    expect(screen.getByRole("button", { name: "Добавлено ✓" })).toBeTruthy();
  });

  it("shows copy feedback after copying for AI", () => {
    renderPopup({ draft: "текст" });
    fireEvent.click(screen.getByRole("button", { name: "Скопировать для ИИ" }));
    expect(screen.getByRole("button", { name: "Скопировано ✓" })).toBeTruthy();
  });
});
