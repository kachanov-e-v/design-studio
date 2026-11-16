import { describe, it, expect } from "vitest";
import { pickAnnouncementOrigin } from "./announcementOrigin";

describe("pickAnnouncementOrigin (RT-01)", () => {
  it("targets the immediate parent, not the topmost frame", () => {
    expect(pickAnnouncementOrigin(["vscode-webview://abc", "vscode-file://vscode-app"]))
      .toBe("vscode-webview://abc");
  });

  it("returns the single entry unchanged", () => {
    expect(pickAnnouncementOrigin(["http://127.0.0.1:9533"])).toBe("http://127.0.0.1:9533");
  });

  it("returns null for an empty, absent or null-only list", () => {
    expect(pickAnnouncementOrigin([])).toBeNull();
    expect(pickAnnouncementOrigin(undefined)).toBeNull();
    expect(pickAnnouncementOrigin(null)).toBeNull();
    expect(pickAnnouncementOrigin([null as unknown as string])).toBeNull();
  });
});
