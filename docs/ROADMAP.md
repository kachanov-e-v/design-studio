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
| Next.js (dev server) | Works (localhost binding + proxy-injected runtime) | Partial: global CSS works; CSS Modules (hashed class names) and Tailwind do not match source | Journal `pending` → agent applies to TSX |

## Improvement backlog (prioritized)

1. **Autodetect dev server** — read workspace `package.json` scripts (`next dev`, `vite`, etc.), propose the binding URL automatically instead of manual entry. Cheapest win.
2. **CSS persistence via dev-source maps** — Next.js dev serves sourcemaps for CSS; map hashed CSS Modules class names in the DOM back to `*.module.css` sources, so Save works for CSS Modules too. Highest value.
3. **Tailwind inline edits** — instead of raw CSS properties, translate style edits into utility-class changes (or hand off to the agent with the target class list).
4. **Structural DOM→source mapping** — for pure HTML projects, apply move/duplicate/delete directly to the HTML file with a position-based mapping; frameworks keep the MCP/agent path.
5. **OpenCode + Cline** — MCP registration docs and availability probing; core is already agent-agnostic.
6. **RSC/SPA navigation handling** — Next.js App Router client-side navigation bypasses the proxy per document; keep runtime alive and re-handshake across soft navigations.
