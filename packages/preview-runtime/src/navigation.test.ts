import { describe, it, expect } from "vitest";
import { shouldHijackToAssign } from "./navigation";

describe("browse-mode hijack decision (NAV-02)", () => {
  const preview = "http://127.0.0.1:9533";
  const upstream = "http://localhost:3000";

  it("lets same-origin clicks on bare-path documents navigate natively (SPA keeps working)", () => {
    expect(shouldHijackToAssign("/boards/x", preview, preview)).toBe(false);
    expect(shouldHijackToAssign("/", preview, preview)).toBe(false);
  });

  it("hijacks same-origin clicks on structured /proxy/ documents", () => {
    expect(shouldHijackToAssign("/proxy/http/localhost:3000/boards/x", preview, preview)).toBe(true);
  });

  it("hijacks upstream-origin links on bare-path documents to stay on the preview host", () => {
    expect(shouldHijackToAssign("/boards/x", upstream, preview)).toBe(true);
  });

  it("hijacks when the preview origin is unknown", () => {
    expect(shouldHijackToAssign("/boards/x", upstream, null)).toBe(true);
  });
});
