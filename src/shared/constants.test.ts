import { describe, it, expect } from "vitest";
import { EXTENSION_ID, OPEN_COMMAND } from "../shared/constants";

describe("shared constants", () => {
  it("has expected extension id", () => {
    expect(EXTENSION_ID).toBe("design-studio");
  });
  it("has expected open command", () => {
    expect(OPEN_COMMAND).toBe("design-studio.open");
  });
});