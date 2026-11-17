// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { BoxModel } from "./BoxModel";

afterEach(cleanup);

const elementStyles = {
  margin: "1px 2px 3px 4px",
  "border-width": "0px",
  padding: "8px",
};

function renderBoxModel(onApplyStyle = vi.fn(), styles = elementStyles) {
  render(
    <BoxModel
      elementStyles={styles}
      rect={{ width: 10.4, height: 20.6 }}
      onApplyStyle={onApplyStyle}
    />
  );
  return onApplyStyle;
}

describe("BoxModel", () => {
  it("shows per-side values expanded from shorthands and the content size", () => {
    renderBoxModel();
    expect(screen.getByRole("button", { name: "margin top" }).textContent).toBe("1px");
    expect(screen.getByRole("button", { name: "margin right" }).textContent).toBe("2px");
    expect(screen.getByRole("button", { name: "margin bottom" }).textContent).toBe("3px");
    expect(screen.getByRole("button", { name: "margin left" }).textContent).toBe("4px");
    expect(screen.getByRole("button", { name: "padding top" }).textContent).toBe("8px");
    expect(screen.getByText("10 × 21")).toBeTruthy();
  });

  it("recomposes the shorthand after editing one side", () => {
    const onApplyStyle = renderBoxModel();
    fireEvent.click(screen.getByRole("button", { name: "margin top" }));
    const input = screen.getByRole("textbox", { name: "margin top" }) as HTMLInputElement;
    expect(input.value).toBe("1px");
    fireEvent.change(input, { target: { value: "5px" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onApplyStyle).toHaveBeenCalledWith("margin", "5px 2px 3px 4px");
  });

  it("collapses equal sides when recomposing", () => {
    const onApplyStyle = renderBoxModel();
    fireEvent.click(screen.getByRole("button", { name: "padding top" }));
    const input = screen.getByRole("textbox", { name: "padding top" });
    fireEvent.change(input, { target: { value: "4px" } });
    fireEvent.blur(input);
    expect(onApplyStyle).toHaveBeenCalledWith("padding", "4px 8px 8px");
  });

  it("cancels editing on Escape without applying", () => {
    const onApplyStyle = renderBoxModel();
    fireEvent.click(screen.getByRole("button", { name: "margin left" }));
    const input = screen.getByRole("textbox", { name: "margin left" });
    fireEvent.change(input, { target: { value: "9px" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onApplyStyle).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "margin left" }).textContent).toBe("4px");
  });

  it("disables sides when the shorthand cannot be parsed", () => {
    renderBoxModel(vi.fn(), { ...elementStyles, margin: "calc(1px + 2%) 0px" });
    const cell = screen.getByRole("button", { name: "margin top" }) as HTMLButtonElement;
    expect(cell.disabled).toBe(true);
    expect(cell.textContent).toBe("–");
  });
});