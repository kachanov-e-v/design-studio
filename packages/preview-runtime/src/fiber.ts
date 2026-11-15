import type { ComponentInfo } from "./protocol.js";

/**
 * Best-effort React component identification for a DOM element.
 *
 * Works only in dev builds: React attaches a `__reactFiber$<key>` expando to
 * rendered elements and keeps a `_debugOwner` chain on fibers. React 18 also
 * records `_debugSource` (file + line of the JSX that produced the element);
 * React 19 removed it, so we fall back to `_debugStack` frames when present.
 *
 * All extraction is defensive: failures return an empty list, never throw.
 */

interface DebugSource {
  fileName?: unknown;
  lineNumber?: unknown;
}

interface FiberLike {
  type?: unknown;
  tag?: number;
  _debugOwner?: FiberLike | null;
  _debugSource?: DebugSource;
  _debugStack?: unknown;
  return?: FiberLike | null;
}

const SOURCE_FILE = /\.(tsx|jsx|ts|js|mjs|cjs)$/i;
const NON_SOURCE_FRAME = /node_modules|chunks\/|\.next\/static|webpack\/bootstrap|polyfills|framework|main-app|_app-|internals/i;

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return undefined;
  return trimmed;
}

function componentDisplayName(type: unknown): string | undefined {
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    return asString(fn.displayName, 100) ?? asString(fn.name, 100);
  }
  if (type && typeof type === "object") {
    // forwardRef / memo wrappers expose the inner component via `render` or `type`
    const wrapper = type as Record<string, unknown>;
    const inner =
      typeof wrapper.render === "function" || (wrapper.render && typeof wrapper.render === "object")
        ? (wrapper.render as { displayName?: unknown; name?: unknown })
        : typeof wrapper.type === "function" || (wrapper.type && typeof wrapper.type === "object")
          ? (wrapper.type as { displayName?: unknown; name?: unknown })
          : undefined;
    return asString(wrapper.displayName, 100) ?? asString(inner?.displayName, 100) ?? asString(inner?.name, 100);
  }
  return undefined;
}

/** Extract the most plausible source frame (file:line) from a `_debugStack`. */
export function parseOwnerStack(stack: unknown, limit = 3): { file: string; line?: number }[] {
  const text = typeof stack === "string" ? stack : stack && typeof (stack as Error).stack === "string" ? (stack as Error).stack : undefined;
  if (!text) return [];
  const out: { file: string; line?: number }[] = [];
  const re = /([^\s()"']+?\.(?:tsx|jsx|ts|js|mjs|cjs)):(\d+):(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null && out.length < limit) {
    let file = match[1];
    // strip bundler prefixes: webpack-internal:///./src/x.tsx, /(app-pages-browser)/./src/x.tsx
    file = file.replace(/^(?:webpack-internal:\/\/\/?)/, "");
    const group = file.match(/^\([^)]*\)\/(.+)$/);
    if (group) file = group[1] ?? file;
    // captures that skipped a "(group)" prefix start with "/./" — normalize
    file = file.replace(/^\/(?:\.\/)?/, "./");
    if (!SOURCE_FILE.test(file) || NON_SOURCE_FRAME.test(file)) continue;
    const line = Number.parseInt(match[2], 10);
    out.push({ file, line: Number.isFinite(line) && line > 0 ? line : undefined });
  }
  return out;
}

function sourceFromFiber(fiber: FiberLike): { file?: string; line?: number } {
  const src = fiber._debugSource;
  if (src && typeof src === "object") {
    const file = asString(src.fileName, 500);
    const line = typeof src.lineNumber === "number" && Number.isFinite(src.lineNumber) && src.lineNumber > 0 ? src.lineNumber : undefined;
    if (file) return { file: file.replace(/^(?:webpack-internal:\/\/\/?)/, ""), line };
  }
  const stack = parseOwnerStack(fiber._debugStack, 1)[0];
  if (stack) return { file: stack.file, line: stack.line };
  return {};
}

function pushOwner(out: ComponentInfo[], seen: Set<string>, owner: FiberLike, sourceOverride?: { file?: string; line?: number }): void {
  const name = componentDisplayName(owner.type);
  const { file, line } = sourceOverride ?? sourceFromFiber(owner);
  if (!name && !file) return;
  if (name && seen.has(name)) return;
  if (name) seen.add(name);
  out.push({ ...(name !== undefined ? { name } : {}), ...(file !== undefined ? { file, line } : {}) });
}

export function findFiber(el: Element): FiberLike | undefined {
  try {
    const holder = el as unknown as Record<string, unknown>;
    const fiberKey = Object.keys(holder).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternal$"));
    if (!fiberKey) return undefined;
    const fiber = holder[fiberKey];
    return fiber && typeof fiber === "object" ? (fiber as FiberLike) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk the React owner chain for an element and return component info,
 * nearest owner first. Primary strategy is the `_debugOwner` chain; when it
 * is unavailable (React 19 dev builds), walk `fiber.return` up and collect
 * the function/class component fibers on the way to the root — the same
 * approach React DevTools uses for its component stack. Returns an empty
 * array outside React dev builds.
 */
export function collectReactComponents(el: Element): ComponentInfo[] {
  try {
    const fiber = findFiber(el);
    if (!fiber) return [];
    const seen = new Set<string>();
    // The element's own `_debugSource` points at its JSX inside the nearest
    // owning component — the most precise location available.
    const ownSource = sourceFromFiber(fiber);
    const out: ComponentInfo[] = [];

    let cur: FiberLike | null | undefined = fiber._debugOwner;
    let guard = 0;
    while (cur && typeof cur === "object" && guard++ < 32) {
      pushOwner(out, seen, cur, out.length === 0 && (ownSource.file || ownSource.line) ? ownSource : undefined);
      cur = cur._debugOwner;
    }

    if (out.length === 0) {
      cur = fiber.return;
      guard = 0;
      while (cur && typeof cur === "object" && guard++ < 48) {
        if (cur.type === undefined || cur.type === null) break; // above the component root (HostRoot/Offscreen)
        if (typeof cur.type !== "string") {
          // skip host fibers (type is a tag string); collect component fibers
          pushOwner(out, seen, cur, out.length === 0 && (ownSource.file || ownSource.line) ? ownSource : undefined);
        }
        cur = cur.return;
      }
    }

    return out.slice(0, 6);
  } catch {
    return [];
  }
}
