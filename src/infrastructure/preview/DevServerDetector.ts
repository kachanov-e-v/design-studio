import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

export interface DevServerCandidate {
  /** Bindable URL, e.g. http://localhost:3000 */
  url: string;
  /** Script that produced the candidate, e.g. "dev: next dev" */
  script: string;
  /** True when the port answered a TCP probe at detection time. */
  running: boolean;
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
    const candidate: DevServerCandidate = {
      url: `http://localhost:${port}`,
      script: nameIsDev ? name : `${name}: ${script}`,
      running: false,
    };
    (matched ? specific : generic).push(candidate);
  }

  // generic dev/start/serve scripts with an unknown tool: try common ports
  if (genericDevScripts > 0) {
    for (const port of FALLBACK_PORTS) {
      if (!seenPorts.has(port)) {
        seenPorts.add(port);
        generic.push({ url: `http://localhost:${port}`, script: "default ports", running: false });
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

/**
 * Detect the project's localhost dev server from its package.json scripts
 * and mark which candidates are currently accepting connections.
 */
export async function detectDevServers(root: string): Promise<DevServerCandidate[]> {
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
  // running servers first, then framework-detected, then generic defaults
  return candidates.sort((a, b) => Number(b.running) - Number(a.running));
}
