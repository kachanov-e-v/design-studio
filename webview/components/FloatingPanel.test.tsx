// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FloatingPanel } from "./FloatingPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FloatingPanel toasts", () => {
  it("shows the status as a toast and auto-dismisses it", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<FloatingPanel status="Скопировано" seq={1} language="ru" onDismiss={onDismiss} />);
    expect(screen.getByRole("status").textContent).toContain("Скопировано");
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("re-arms the timer when the same message arrives again (seq bump)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<FloatingPanel status="Готово" seq={1} language="ru" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(<FloatingPanel status="Готово" seq={2} language="ru" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses via the close button", () => {
    const onDismiss = vi.fn();
    render(<FloatingPanel status="Готово" seq={1} language="ru" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть уведомление" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a status", () => {
    const { container } = render(<FloatingPanel status="" seq={0} language="ru" onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});