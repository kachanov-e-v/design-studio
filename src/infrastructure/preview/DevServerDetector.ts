import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";

export type DevServerKind = "vite" | "next" | "astro" | "webpack" | "static-http" | "unknown";

export interface DevServerCandidate {
  /** Bindable URL, e.g. http://localhost:3000 */
  url: string;
  /** Script that produced the candidate, e.g. "dev: next dev" */
  script: string;
  /** True when the port answered a TCP probe at detection time. */
  running: boolean;
  /** What responded to the HTTP probe, for known dev-server fingerprints. */
  kind: DevServerKind;
  /** true: content matches a workspace entry; false: proved foreign; null: not checked. */
  matchesProject: boolean | null;
}

/** [pattern, default port] pairs; first match wins per script. */
const SCRIPT_PATTERNS: Array<[RegExp, number]> = [
  [/\bnext(?:\s|$)/, 3000],
  [/\bvite(?:\s|$)/, 5173],
  [/\breact-scripts(?:\s|$)/, 3000],
  [/\bastro(?:\s|$)/, 4321],
  [/webpack(-dev-server)?\s+serve/, 8080],
  [/\brspack(?:\s|$)/, 8080],
  [/\bserve(?:\s|$)/, 3000],
  [/\bhttp-server(?:\s|$)/, 8080],
  [/\bparcel(?:\s|$)/, 1234],
];

const NPM_RUN_PREFIX = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)/;
const DEV_SCRIPT_NAME = /^(?:dev|serve|start)$/;
const SCRIPT_REF = /^[A-Za-z0-9:._-]+$/;
const FALLBACK_PORTS = [3000, 5173, 8080];

/** Pull an explicit port out of a dev script: "-p 4000", "--port=4173", "-- -p 4000". */
function explicitPort(script: string): number | null {
  const flag = /(?:^|\s)(?:-{1,2}p|--port)(?:=|\s+)(\d{1,5})/.exec(script);
  if (!flag) return null;
  const port = Number(flag[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

function freshCandidate(url: string, script: string): DevServerCandidate {
  return { url, script, running: false, kind: "unknown", matchesProject: null };
}

/** Pure: parse package.json content into candidate URLs (no probing). */
export function devServerCandidatesFromPackageJson(content: string): DevServerCandidate[] {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(content);
  } catch {
    return [];
  }
  const scripts = pkg.scripts ?? {};
  const seenPorts = new Set<number>();
  const specific: DevServerCandidate[] = [];
  const generic: DevServerCandidate[] = [];
  let genericDevScripts = 0;

  for (const [name, raw] of Object.entries(scripts)) {
    if (typeof raw !== "string") continue;
    const nameIsDev = DEV_SCRIPT_NAME.test(name);
    const script = resolveScriptValue(raw, scripts, 0);
    if (script === null) continue;
    const matched = SCRIPT_PATTERNS.find(([re]) => re.test(script));
    const port = explicitPort(script) ?? matched?.[1] ?? null;
    if (port === null || (!nameIsDev && !matched) || seenPorts.has(port)) {
      if (nameIsDev && port === null) genericDevScripts++;
      continue;
    }
    seenPorts.add(port);
    const candidate = freshCandidate(`http://localhost:${port}`, nameIsDev ? name : `${name}: ${script}`);
    (matched ? specific : generic).push(candidate);
  }

  // generic dev/start/serve scripts with an unknown tool: try common ports
  if (genericDevScripts > 0) {
    for (const port of FALLBACK_PORTS) {
      if (!seenPorts.has(port)) {
        seenPorts.add(port);
        generic.push(freshCandidate(`http://localhost:${port}`, "default ports"));
      }
    }
  }

  return [...specific, ...generic];
}

/**
 * Resolve a script value into the actual dev command. "npm run next-dev" style
 * wrappers are followed to the referenced script; unknown references become null.
 */
function resolveScriptValue(raw: string, scripts: Record<string, string>, depth: number): string | null {
  let value = raw.trim();
  let usesWrapper = false;
  for (;;) {
    value = value.replace(/^--silent\s+/, "");
    const wrapper = NPM_RUN_PREFIX.exec(value);
    if (wrapper) {
      value = value.slice(wrapper[0].length).trim();
      usesWrapper = true;
      continue;
    }
    break;
  }
  if (usesWrapper && SCRIPT_REF.test(value)) {
    if (depth >= 3) return null;
    const referenced = scripts[value];
    if (typeof referenced !== "string") return null;
    return resolveScriptValue(referenced, scripts, depth + 1);
  }
  return value;
}

function readPackageJson(root: string): string | null {
  try {
    return fs.readFileSync(path.join(root, "package.json"), "utf8");
  } catch {
    return null;
  }
}

export function probePort(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export interface HttpProbe {
  ok: boolean;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** GET a URL with a hard timeout, keeping only the first maxBytes of the body. */
export function probeHttp(url: string, timeoutMs = 750, maxBytes = 64 * 1024): Promise<HttpProbe> {
  return new Promise((resolve) => {
    let settled = false;
    let body = "";
    const finish = (probe: HttpProbe) => {
      if (!settled) {
        settled = true;
        resolve(probe);
      }
    };
    const req = http.get(url, { timeout: timeoutMs, headers: { Connection: "close" } }, (res) => {
      res.setTimeout(timeoutMs);
      res.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (body.length >= maxBytes) req.destroy();
      });
      res.on("end", () => finish({ ok: true, status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on("close", () => finish({ ok: true, status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => finish({ ok: false, status: 0, headers: {}, body }));
  });
}

function headerValue(headers: http.IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? value.join(",") : (value ?? "");
}

/** Identify a dev-server fingerprint from an HTTP probe. */
export function fingerprintServer(probe: HttpProbe): DevServerKind {
  if (!probe.ok) return "unknown";
  const body = probe.body;
  const powered = headerValue(probe.headers, "x-powered-by");
  const server = headerValue(probe.headers, "server");
  if (body.includes("/@vite/client") || body.includes("/@vite/dist/client")) return "vite";
  if (powered.includes("Astro") || body.includes("astro-island") || body.includes("/_astro")) return "astro";
  if (powered.includes("Next.js") || body.includes("/_next/static")) return "next";
  if (
    server.includes("webpack") ||
    body.includes("/webpack-hmr") ||
    body.includes("webpack-dev-server")
  ) {
    return "webpack";
  }
  return "static-http";
}

const DEV_KINDS: Set<DevServerKind> = new Set(["vite", "next", "astro", "webpack"]);

function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, " ").trim();
  return title || null;
}

async function readLocalTitle(file: string): Promise<string | null> {
  try {
    const content = await fsp.readFile(file, "utf8");
    return htmlTitle(content);
  } catch {
    return null;
  }
}

/**
 * Prove (or disprove) that a dev server serves this workspace: fetch the
 * workspace HTML entries through the server and compare their <title> with
 * the local files. Returns null when nothing can be checked.
 */
export async function verifyProjectMatch(
  url: string,
  root: string,
  entries: string[],
  maxEntries = 3,
  timeoutMs = 750
): Promise<boolean | null> {
  if (entries.length === 0) return null;
  const base = url.endsWith("/") ? url : `${url}/`;
  let checked = 0;
  for (const entry of entries.slice(0, maxEntries)) {
    const localTitle = await readLocalTitle(path.join(root, entry));
    if (!localTitle) continue;
    const target = new URL(entry.replace(/^\/+/, ""), base).toString();
    const probe = await probeHttp(target, timeoutMs, 32 * 1024);
    if (!probe.ok || probe.status !== 200) continue;
    checked++;
    const remoteTitle = htmlTitle(probe.body);
    if (remoteTitle && remoteTitle === localTitle) return true;
  }
  return checked > 0 ? false : null;
}

/** Verification level of a candidate, lower sorts first. */
function confidence(candidate: DevServerCandidate): number {
  if (candidate.matchesProject === true) return 0;
  if (candidate.running && candidate.matchesProject !== false && DEV_KINDS.has(candidate.kind)) return 1;
  if (candidate.running) return 2;
  return 3;
}

/**
 * Detect the project's localhost dev server from its package.json scripts,
 * verify live candidates over HTTP (fingerprint + workspace title match)
 * and sort by confidence: proven, fingerprinted, live-but-unverified, down.
 */
export async function detectDevServers(
  root: string,
  verifyEntries: string[] = []
): Promise<DevServerCandidate[]> {
  const content = readPackageJson(root);
  if (!content) return [];
  const candidates = devServerCandidatesFromPackageJson(content);
  if (candidates.length === 0) return [];

  await Promise.all(
    candidates.map(async (candidate) => {
      const port = Number(new URL(candidate.url).port);
      candidate.running = await probePort(port);
    })
  );

  await Promise.all(
    candidates
      .filter((candidate) => candidate.running)
      .map(async (candidate) => {
        const probe = await probeHttp(candidate.url);
        if (!probe.ok) return; // answered TCP but speaks no HTTP: leave unverified
        candidate.kind = fingerprintServer(probe);
        if (candidate.kind === "static-http") {
          candidate.matchesProject = await verifyProjectMatch(candidate.url, root, verifyEntries);
        }
      })
  );

  // proven project match > fingerprinted dev server > live but unverified > down
  return candidates.sort((a, b) => confidence(a) - confidence(b));
}
