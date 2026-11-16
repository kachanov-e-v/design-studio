// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Inspector } from "./Inspector";
import type { ElementPayload } from "../types";

/**
 * P2-5/P2-18: the inspector must not flood the runtime with style applies
 * while a slider/color control is dragged, and the text field must commit
 * on blur as the README promises.
 */

const baseSelected: ElementPayload = {
  selector: "h1",
  tag: "h1",
  rect: { top: 0, left: 0, width: 10, height: 10 },
  styles: { opacity: "0.5", color: "rgb(255, 0, 0)" },
  text: "Hello",
};

function renderInspector(overrides: { onApplyStyle?: (property: string, value: string) => void; onEditText?: (text: string) => void; selected?: ElementPayload } = {}) {
  return render(
    <Inspector
      selected={overrides.selected ?? baseSelected}
      onApplyStyle={overrides.onApplyStyle ?? vi.fn()}
      onApplyOp={vi.fn()}
      onEditText={overrides.onEditText ?? vi.fn()}
      onCopyComponent={vi.fn()}
      language="ru"
    />
  );
}

afterEach(cleanup);

describe("Inspector text commit (P2-18)", () => {
  afterEach(() => vi.useRealTimers());

  it("commits the text field on blur", () => {
    const onEditText = vi.fn();
    renderInspector({ onEditText });
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
    const slider = screen.getByRole("slider");
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
