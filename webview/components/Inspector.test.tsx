// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Inspector } from "./Inspector";
import type { ElementPayload } from "../types";
import type { DesignEdit } from "../../src/domain/entities/DesignEdit";

/**
 * P2-5/P2-18: the inspector must not flood the runtime with style applies
 * while a slider/color control is dragged, and the text field must commit
 * on blur as the README promises.
 * Sections are collapsed by default now — tests expand them first.
 */

const baseSelected: ElementPayload = {
  selector: "h1",
  tag: "h1",
  rect: { top: 0, left: 0, width: 10, height: 10 },
  styles: { opacity: "0.5", color: "rgb(255, 0, 0)" },
  text: "Hello",
};

function renderInspector(overrides: {
  onApplyStyle?: (property: string, value: string) => void;
  onEditText?: (text: string) => void;
  selected?: ElementPayload;
  edits?: DesignEdit[];
  onUndoStructure?: (requestId: string) => void;
} = {}) {
  return render(
    <Inspector
      selected={overrides.selected ?? baseSelected}
      onApplyStyle={overrides.onApplyStyle ?? vi.fn()}
      onApplyOp={vi.fn()}
      onEditText={overrides.onEditText ?? vi.fn()}
      onCopyComponent={vi.fn()}
      language="ru"
      instruction=""
      onInstructionChange={vi.fn()}
      edits={overrides.edits ?? []}
      onCopyInstruction={vi.fn()}
      onUndoStructure={overrides.onUndoStructure}
    />
  );
}

function openSection(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(cleanup);

describe("Inspector collapsible sections", () => {
  it("collapses element sections by default and expands on click", () => {
    renderInspector();
    expect(screen.queryByDisplayValue("Hello")).toBeNull();
    openSection("Текст");
    expect(screen.getByDisplayValue("Hello")).toBeTruthy();
  });
});

describe("Inspector text commit (P2-18)", () => {
  afterEach(() => vi.useRealTimers());

  it("commits the text field on blur", () => {
    const onEditText = vi.fn();
    renderInspector({ onEditText });
    openSection("Текст");
    const textInput = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: "Hello world" } });
    expect(onEditText).not.toHaveBeenCalled();
    fireEvent.blur(textInput);
    expect(onEditText).toHaveBeenCalledWith("Hello world");
  });
});

describe("Inspector slider throttling (P2-5)", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces range changes into one apply and commits on release", () => {
    vi.useFakeTimers();
    const onApplyStyle = vi.fn();
    renderInspector({ onApplyStyle });
    openSection("Стили");
    const slider = screen.getByRole("slider", { name: "opacity" });
    fireEvent.change(slider, { target: { value: "0.8" } });
    fireEvent.change(slider, { target: { value: "0.9" } });
    expect(onApplyStyle).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onApplyStyle).toHaveBeenCalledTimes(1);
    expect(onApplyStyle).toHaveBeenCalledWith("opacity", "0.9");
  });
});

describe("Inspector color throttling (P2-5)", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces color picker changes into one apply", () => {
    vi.useFakeTimers();
    const onApplyStyle = vi.fn();
    renderInspector({ onApplyStyle });
    openSection("Стили");
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#00ff00" } });
    expect(onApplyStyle).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onApplyStyle).toHaveBeenCalledTimes(1);
    expect(onApplyStyle).toHaveBeenCalledWith("color", "#00ff00");
  });
});

describe("Inspector debounce timer safety", () => {
  afterEach(() => vi.useRealTimers());

  it("cancels pending previews on unmount", () => {
    vi.useFakeTimers();
    const onApplyStyle = vi.fn();
    const { unmount } = renderInspector({ onApplyStyle });
    openSection("Стили");
    fireEvent.change(screen.getByRole("slider", { name: "opacity" }), { target: { value: "0.8" } });
    unmount();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onApplyStyle).not.toHaveBeenCalled();
  });

  it("does not apply a stale preview after the selection changed", () => {
    vi.useFakeTimers();
    const onApplyStyle = vi.fn();
    const { rerender } = renderInspector({ onApplyStyle });
    openSection("Стили");
    fireEvent.change(screen.getByRole("slider", { name: "opacity" }), { target: { value: "0.8" } });
    rerender(
      <Inspector
        selected={{ ...baseSelected, selector: "h2", tag: "h2" }}
        onApplyStyle={onApplyStyle}
        onApplyOp={vi.fn()}
        onEditText={vi.fn()}
        onCopyComponent={vi.fn()}
        language="ru"
        instruction=""
        onInstructionChange={vi.fn()}
        edits={[]}
        onCopyInstruction={vi.fn()}
      />
    );
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onApplyStyle).not.toHaveBeenCalled();
  });
});

describe("Inspector structure undo", () => {
  it("renders an undo button for structure edits with a requestId and calls onUndoStructure", () => {
    const onUndoStructure = vi.fn();
    const edits: DesignEdit[] = [
      { kind: "structure", selector: "h1", operation: "duplicate", requestId: "req-1" },
      { kind: "structure", selector: "h1", operation: "move-up" },
    ];
    renderInspector({ edits, onUndoStructure });
    const buttons = screen.getAllByRole("button", { name: "Отменить структурную правку" });
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]);
    expect(onUndoStructure).toHaveBeenCalledWith("req-1");
  });
});

describe("Inspector journal kind chips", () => {
  it("labels each journal entry with its edit kind", () => {
    render(
      <Inspector
        selected={baseSelected}
        onApplyStyle={vi.fn()}
        onApplyOp={vi.fn()}
        onEditText={vi.fn()}
        onCopyComponent={vi.fn()}
        language="ru"
        instruction=""
        onInstructionChange={vi.fn()}
        edits={[
          { kind: "style", selector: "h1", property: "color", before: "red", after: "blue" },
          { kind: "comment", selector: "h1", after: "Добавить тень" },
        ]}
        onCopyInstruction={vi.fn()}
      />
    );
    expect(screen.getByText("стиль")).toBeTruthy();
    expect(screen.getByText("комментарий")).toBeTruthy();
  });
});

describe("Inspector color alpha (IMP-G phase 2)", () => {
  afterEach(() => vi.useRealTimers());

  it("applies an rgba value when the alpha slider moves", () => {
    vi.useFakeTimers();
    const onApplyStyle = vi.fn();
    renderInspector({ onApplyStyle });
    openSection("Стили");
    const alpha = screen.getByRole("slider", { name: "color alpha" });
    fireEvent.change(alpha, { target: { value: "0.4" } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onApplyStyle).toHaveBeenCalledWith("color", "rgba(255, 0, 0, 0.4)");
  });
});

describe("Inspector property filter (IMP-G phase 2)", () => {
  it("narrows style controls to the query and hides the box model", () => {
    renderInspector();
    openSection("Стили");
    expect(screen.getByText("display")).toBeTruthy();
    expect(screen.getByLabelText("box model")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Фильтр свойств…"), { target: { value: "opacity" } });
    expect(screen.getByText("opacity")).toBeTruthy();
    expect(screen.queryByText("display")).toBeNull();
    expect(screen.queryByLabelText("box model")).toBeNull();
  });

  it("reports when nothing matches the filter", () => {
    renderInspector();
    openSection("Стили");
    fireEvent.change(screen.getByPlaceholderText("Фильтр свойств…"), { target: { value: "zzz" } });
    expect(screen.getByText("Нет свойств по запросу.")).toBeTruthy();
  });
});

describe("Inspector typography preview (IMP-G phase 2)", () => {
  it("renders a live sample styled from the selected element", () => {
    renderInspector({
      selected: {
        ...baseSelected,
        styles: { ...baseSelected.styles, "font-family": "Georgia", "font-size": "18px", "font-weight": "bold" },
      },
    });
    openSection("Стили");
    const sample = screen.getByText("Aa Текст 123");
    expect(sample.style.fontFamily).toBe("Georgia");
    expect(sample.style.fontSize).toBe("18px");
    expect(sample.style.fontWeight).toBe("bold");
  });

  it("caps huge font sizes in the preview", () => {
    renderInspector({
      selected: { ...baseSelected, styles: { ...baseSelected.styles, "font-size": "200px" } },
    });
    openSection("Стили");
    expect(screen.getByText("Aa Текст 123").style.fontSize).toBe("28px");
  });
});
