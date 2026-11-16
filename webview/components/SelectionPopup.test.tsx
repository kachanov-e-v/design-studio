// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SelectionPopup } from "./SelectionPopup";

/**
 * P2-6: the popup must offer an explicit close affordance.
 */
afterEach(cleanup);

describe("SelectionPopup close (P2-6)", () => {
  const target = {
    rect: { top: 4, left: 4, width: 10, height: 10 },
    components: [],
  };

  it("renders a close button and calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SelectionPopup
        target={target}
        language="ru"
        onReveal={vi.fn()}
        onCopyInstruction={vi.fn()}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
