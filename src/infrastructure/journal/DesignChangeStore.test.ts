import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DesignChangeStore } from "./DesignChangeStore";

const tempDirs: string[] = [];

function makeStore(): { store: DesignChangeStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-journal-"));
  tempDirs.push(root);
  return { store: new DesignChangeStore(root), root };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const element = {
  selector: "div.hero",
  tag: "div",
  rect: { top: 0, left: 0, width: 100, height: 50 },
  styles: { color: "red" },
};

describe("DesignChangeStore", () => {
  it("records an applied style change with journal + state files", () => {
    const { store, root } = makeStore();
    const record = store.recordStyleApplied({ selector: "div.hero", property: "color", value: "purple", file: "styles.css" });
    expect(record.status).toBe("applied-to-source");
    expect(fs.existsSync(store.journalPath)).toBe(true);
    const raw = fs.readFileSync(store.journalPath, "utf8");
    expect(raw).toContain('"kind":"style"');
    expect(fs.existsSync(store.statePath)).toBe(true);
    const state = fs.readFileSync(store.statePath, "utf8");
    expect(state).toContain(path.basename(root));
    expect(state).toContain("styles.css");
    expect(state).toContain("_No pending design changes._");
  });

  it("records pending structural changes and acknowledges them", () => {
    const { store } = makeStore();
    const change = store.recordPending({ kind: "structure", selector: "div.card", op: "delete" });
    expect(store.pendingChanges()).toHaveLength(1);
    const ack = store.acknowledge([change.id]);
    expect(ack.acknowledged).toBe(1);
    expect(store.pendingChanges()).toHaveLength(0);
    const after = store.readChanges();
    expect(after[0].status).toBe("applied-to-source");
    expect(after[0].note).toContain("MCP");
  });

  it("reports missing ids on acknowledge", () => {
    const { store } = makeStore();
    store.recordPending({ kind: "text", selector: "h1", text: "Hello" });
    const ack = store.acknowledge(["missing-id"]);
    expect(ack.acknowledged).toBe(0);
    expect(ack.missing).toEqual(["missing-id"]);
  });

  it("filters changes since timestamp", () => {
    const { store } = makeStore();
    store.recordPending({ kind: "structure", selector: "a", op: "move-up" });
    const all = store.readChanges();
    const before = new Date(Date.parse(all[0].ts) - 1000).toISOString();
    const after = new Date(Date.parse(all[0].ts) + 1000).toISOString();
    expect(store.changesSince(before)).toHaveLength(1);
    expect(store.changesSince(after)).toHaveLength(0);
  });

  it("writes and completes element handoff", () => {
    const { store } = makeStore();
    expect(store.readHandoff()).toBeNull();
    store.writeHandoff(element, "make the call to action larger");
    const handoff = store.readHandoff();
    expect(handoff?.instruction).toBe("make the call to action larger");
    expect(handoff?.status).toBe("new");
    expect(handoff?.element.selector).toBe("div.hero");
    expect(store.completeHandoff()).toBe(true);
    expect(store.readHandoff()?.status).toBe("accepted");
  });

  it("refreshState lists pending items for agents", () => {
    const { store } = makeStore();
    store.recordPending({ kind: "structure", selector: "ul > li", op: "duplicate" });
    const state = fs.readFileSync(store.statePath, "utf8");
    expect(state).toContain("duplicate on ul > li");
    expect(state).toContain("Pending (agent must apply)");
  });
});
