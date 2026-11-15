# Roadmap

- **EPIC 0** — Discovery & Research (done). Architecture, stack, strategies, risks, roadmap, docs, EPIC 1 criteria.
- **EPIC 1** — Project Foundation: extension scaffold, TS, build, commands, basic webview, tests, EDH, docs.
- **EPIC 2** — Design Studio UI: Toolbar, Preview Container, Inspector, floating panel, responsiveness, theme.
- **EPIC 3** — Preview Engine: project detection, preview provider, dev server start by confirmation, display, refresh, state.
- **EPIC 4** — DOM Runtime: bridge, edit mode, hover, selection, highlight, DOM collection.
- **EPIC 5** — Inspector: element data, computed styles, sections, source mapping display, parent navigation.
- **EPIC 6** — Style Editing: property editing, temporary changes, persistence, save, HMR, undo/redo.
- **EPIC 7** — Agentic integration (renamed from "Kilo Integration"): AgentHandoffService, design change journal (`.design-studio/`), MCP stdio server (`dist/mcp-server.js`), element handoff. Kilo Code + Mistral Vibe connected; OpenCode, Cline planned (same registration, agent-agnostic core). Done in the MCP-integration iteration.
- **EPIC 8** — Stabilization: tests, errors, performance, security, accessibility, docs.
- **EPIC 9** — Release Preparation: VSIX, metadata, licenses, README, release notes.
- **EPIC 10** — Project binding (done). Workspace HTML entries served via `/project/` with runtime injection and traversal jail; localhost-only dev server binding; arbitrary external URLs rejected.
- **EPIC 11** — Block editor (done). Inline text editing (double-click), block ops (move up/down, duplicate, delete), extended style editor, new runtime protocol (`ds:apply-op`, `ds:op-applied`, `ds:text-changed`).
- **EPIC 12** — Pending: AI agent applies pending structural/text changes from the journal to source and acknowledges via MCP. Human visual edits are never lost or overwritten.

Each EPIC has completion criteria; do not start next without explicit command.

## Framework support status

| Framework | Preview | Style persistence | Block/text edits |
| --- | --- | --- | --- |
| Static HTML project | Works (file entries) | Works (plain selectors in `*.css`) | Journal `pending` → agent applies |
| Next.js (dev server) | Works (localhost binding + proxy-injected runtime) | Works: global CSS directly; CSS Modules via dev sourcemaps (`File_local__hash` heuristic fallback) | Journal `pending` → agent applies to TSX |
| Tailwind projects | Works (detected at runtime: `--tw-` rules, CDN script, `window.tailwind`) | Style edits are translated into Tailwind utility classes (`src/shared/tailwind.ts` default 3/4 scales, arbitrary values for off-scale values) and applied live via the `set-classes` op; unsupported values fall back to raw CSS | Journal `pending` (kind `style`, final class list + previous classes) → agent applies to source |

## Improvement backlog (prioritized)

1. **Autodetect dev server** (done) — reads workspace `package.json` scripts (`next dev`, `vite`, `react-scripts`, `astro`, etc., incl. `npm run x` references and explicit `-p/--port`), probes ports, and offers the candidate in the project dropdown before manual entry. Live candidates are verified over HTTP: dev-server fingerprints (Vite client injection, `x-powered-by: Next.js`, `astro-island`, webpack HMR) and a workspace `<title>` match demote foreign processes occupying a port.
2. **CSS persistence via dev-source maps** (done) — the preview runtime reports the stylesheet rules the element matches (`href` + selector); the persistence path fetches the dev-server CSS, follows its dev sourcemap (inline or `*.map`), decodes the VLQ mappings to the rule's original position and recovers the unhashed selector from `sourcesContent`. A `File_local__hash` name-pattern heuristic covers servers without sourcemaps. Save then edits the mapped `*.module.css` rule in the workspace.
3. **Tailwind inline edits** (done) — the runtime detects Tailwind (page-level `--tw-` custom properties, CDN script, `window.tailwind`) and reports `classes`/`tailwind` with every element payload. On Tailwind pages style edits from the Inspector are translated into utility classes by a shared pure translator (`src/shared/tailwind.ts`: default 3/4 scales for spacing/sizes/radii/font sizes/weights, palette color map, arbitrary values like `text-[13px]` / `bg-[#0c2238]` off-scale). The new `set-classes` runtime op replaces the element class list (conflicting classes of the same property group are dropped), and the edit is journaled as pending kind `style` with the final class list plus previous classes for the agent. Values that cannot be represented fall back to the raw-CSS path.
4. **Structural DOM→source mapping** — for pure HTML projects, apply move/duplicate/delete directly to the HTML file with a position-based mapping; frameworks keep the MCP/agent path.
5. **OpenCode + Cline** — MCP registration docs and availability probing; core is already agent-agnostic.
6. **RSC/SPA navigation handling** — Next.js App Router client-side navigation bypasses the proxy per document; keep runtime alive and re-handshake across soft navigations.
