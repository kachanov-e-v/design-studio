# Design Studio

VS Code extension: a project-bound visual editor for web apps, integrated with
AI agents (Kilo Code, Mistral Vibe) through MCP. Preview the project's own
pages, edit them visually (Figma-style block and style editing), persist every
change to source or to the design journal — so the AI coding agent always sees
what you changed and never overwrites it.

## Features

- **Project binding** — no arbitrary URLs. Pick an HTML entry file from the
  workspace (or bind to the project's localhost dev server). Served by the
  built-in preview host with the Design Studio runtime injected automatically.
- **Visual editing (edit mode)**
  - hover highlight, click selection;
  - double-click to edit text inline (Enter — commit, Escape — cancel);
  - block operations: move up/down, duplicate, delete;
  - style editor in the Inspector (color, sizing, spacing, typography, flex,
    borders, etc.).
- **Persistence** — "Save" writes style edits into project CSS
  (WorkspaceEdit + document save) and records every change in
  `.design-studio/changes.jsonl` + regenerates `.design-studio/DESIGN_STATE.md`.
- **AI agent integration via MCP** — `dist/mcp-server.js` exposes
  `get_pending_changes`, `get_changes_since`, `acknowledge_changes`,
  `get_selected_element`, `complete_handoff`, `get_project_state`. Pending
  (structure/text) changes are left for the agent to apply in source and
  acknowledge — so the agent knows about your visual edits and won't rewrite
  them.
- **Element handoff** — select an element, type what to change, press
  "Send to AI": context + instruction goes to the agent chat (Kilo Code /
  Mistral Vibe auto-focus, clipboard prompt, plus `.design-studio/handoff.json`
  readable via MCP).
- Undo/Redo via VS Code (WorkspaceEdit).

## Requirements

- VS Code 1.105+
- Node 26+, npm 11+

## Setup

```bash
npm install
npm run build
```

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Launch Extension Development Host: open project in VS Code, press F5.

## Usage

1. Command Palette → "Design Studio: Open Design Studio".
2. Choose a project entry (HTML file) from the dropdown — or "Dev server…" to
   bind the project's localhost dev server. Demo is available for a quick check.
3. Toggle **Edit** mode. Click to select; double-click to edit text; use the
   Inspector for styles and block ops.
4. Press **Save** to commit style edits to source; block/text edits are
   recorded as pending journal entries for the AI agent immediately.
5. Select an element, type an instruction, **Send to AI** — the handoff is
   written to the project and the agent chat is focused.
6. Click **MCP setup** to copy the MCP server config and register it in
   Kilo Code / Mistral Vibe MCP settings (see `docs/INTEGRATIONS.md`).

## Architecture

See `docs/ARCHITECTURE.md`. Layers: extension, presentation (webview),
application, domain, infrastructure (preview host, persistence, journal, MCP
server, agent handoff), packages (preview-runtime).

## Documentation

- `docs/README.md` index
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TECH_STACK.md`
- `docs/SECURITY.md`
- `docs/INTEGRATIONS.md` — MCP setup for Kilo Code / Mistral Vibe (OpenCode, Cline: planned)
- `docs/project-memory/`

## License

MIT (pending).
