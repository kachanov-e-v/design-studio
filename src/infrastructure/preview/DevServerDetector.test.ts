import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
  devServerCandidatesFromPackageJson,
  detectDevServers,
  probePort,
} from "./DevServerDetector";

function pkg(scripts: Record<string, string>): string {
  return JSON.stringify({ name: "app", scripts });
}

const urls = (candidates: { url: string }[]) => candidates.map((c) => c.url);

describe("devServerCandidatesFromPackageJson", () => {
  it("maps next dev to port 3000", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "next dev" })))).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("maps vite to port 5173", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "vite" })))).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("maps react-scripts start to port 3000", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ start: "react-scripts start" })))).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("parses explicit --port for vite", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "vite --port 4173" })))).toEqual([
      "http://localhost:4173",
    ]);
  });

  it("parses explicit -p for next dev", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "next dev -p 4100" })))).toEqual([
      "http://localhost:4100",
    ]);
  });

  it("explicit port takes precedence over the framework default", () => {
    const candidates = devServerCandidatesFromPackageJson(pkg({ dev: "next dev --port 5000" }));
    expect(candidates[0]?.script).toBe("dev");
    expect(urls(candidates)).toEqual(["http://localhost:5000"]);
  });

  it("deduplicates ports across scripts", () => {
    const candidates = devServerCandidatesFromPackageJson(
      pkg({ dev: "vite", build: "next dev -p 5173" })
    );
    // both scripts point at 5173, but only one candidate survives
    expect(urls(candidates).filter((u) => u === "http://localhost:5173")).toHaveLength(1);
  });

  it("resolves npm run references to the underlying dev tool", () => {
    expect(
      urls(
        devServerCandidatesFromPackageJson(
          pkg({ dev: "npm run start:next", "start:next": "next dev" })
        )
      )
    ).toEqual(["http://localhost:3000"]);
  });

  it("skips references to unknown scripts", () => {
    expect(devServerCandidatesFromPackageJson(pkg({ dev: "npm run missing" }))).toEqual([]);
  });

  it("suggests common ports for a generic dev script of an unknown tool", () => {
    const candidates = devServerCandidatesFromPackageJson(pkg({ dev: "my-static-server ." }));
    expect(urls(candidates).slice(0, 3)).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:8080",
    ]);
  });

  it("adds no fallback ports when there is no dev-like script", () => {
    const candidates = devServerCandidatesFromPackageJson(pkg({ build: "tsc" }));
    expect(candidates).toEqual([]);
  });

  it("returns nothing without dev scripts", () => {
    expect(devServerCandidatesFromPackageJson(pkg({}))).toEqual([]);
  });

  it("returns nothing for invalid JSON", () => {
    expect(devServerCandidatesFromPackageJson("not json {")).toEqual([]);
  });
});

describe("probePort", () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports a listening port as running", async () => {
    expect(await probePort(port)).toBe(true);
  });

  it("reports a closed port as not running", async () => {
    expect(await probePort(port + 1)).toBe(false);
  });
});

describe("detectDevServers", () => {
  let server: http.Server;
  let port = 0;
  let tmpRoot: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;

    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ds-detector-"));
    await fs.promises.writeFile(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: {
          dev: `vite --port ${port}`,
          storybook: "storybook dev -p 6006",
          build: "tsc",
        },
      })
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("orders running candidates first and marks them", async () => {
    // avoid probing storybook's unrelated port spam: only our vite port is live
    const candidates = await detectDevServers(tmpRoot);
    expect(candidates[0]).toEqual({
      url: `http://localhost:${port}`,
      script: "dev",
      running: true,
    });
  });

  it("returns an empty list when package.json is missing", async () => {
    const emptyRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ds-empty-"));
    try {
      expect(await detectDevServers(emptyRoot)).toEqual([]);
    } finally {
      await fs.promises.rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
