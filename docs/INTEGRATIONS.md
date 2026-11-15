# Integrations

## Design Studio ↔ AI agents (Kilo Code, Mistral Vibe; later OpenCode, Cline)

Design Studio never lets a visual edit get lost or silently overwritten by the
AI agent working on the same project. Two independent channels make the agent
aware of every change:

### 1. Change journal (ground truth, always written)

Every save in Design Studio appends a record to the project:

```
.design-studio/changes.jsonl     one JSON record per line (append-only log)
.design-studio/DESIGN_STATE.md   human/agent-readable summary, regenerated on each change
```

- `status: "applied-to-source"` — Design Studio itself edited a source file
  (CSS rule updates via WorkspaceEdit). `file` points at the edited file.
- `status: "pending"` — visual-only change (block delete/duplicate/move, inline
  text edit). The AI agent must mirror it in the source files and acknowledge it.
- `DESIGN_STATE.md` contains explicit instructions for the agent: do not revert
  these changes; apply pending ones; acknowledge when done.

### 2. MCP stdio server

`dist/mcp-server.js` is a standard MCP (Model Context Protocol, 2024-11-05)
stdio server that any MCP-capable agent connects to. It reads the journal of
the bound project. Tools:

| Tool                   | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `get_pending_changes`  | List visual changes not yet applied to source (agent must apply these).   |
| `get_changes_since`    | Changes recorded since an ISO timestamp.                                  |
| `acknowledge_changes`  | Mark pending changes as applied to source (after actually applying them). |
| `get_selected_element` | Read the element the human selected + their instruction ("handoff").      |
| `complete_handoff`     | Mark the handoff as accepted.                                             |
| `get_project_state`    | Full DESIGN_STATE.md content.                                             |

Registration (one per project workspace; the webview "MCP setup" button copies
an equivalent config to the clipboard):

```json
{
  "mcpServers": {
    "design-studio": {
      "command": "node",
      "args": ["<extension-dir>\\dist\\mcp-server.js", "<workspace-root>"]
    }
  }
}
```

- **Kilo Code**: put the JSON into the Kilo Code MCP servers settings.
- **Mistral Vibe**: the same config in its MCP settings.
- **OpenCode / Cline**: planned; both speak MCP, so the same server registration
  applies once supported (`AgentHandoffService` / MCP core are agent-agnostic).

### 3. Element handoff ("Send to AI" in the webview)

Selecting an element in edit mode and pressing **Send to AI** with an
instruction:

1. Writes `.design-studio/handoff.json` (element selector, tag, text, styles,
   the human's instruction, status `new`).
2. Detects installed agent chats (Kilo Code, Mistral Vibe) and focuses one.
3. Copies a structured prompt to the clipboard.

The agent reads `handoff.json` through `get_selected_element` (or directly),
continues the conversation, and calls `complete_handoff` when the task is done.

## Kilo Code (command-level)

`AgentHandoffService` probes command ids: `kilo-code.new.openInTab`,
`kilo-code.new.focusChatInput`, and any `kilo-code.*` prefix as fallback.
Mistral Vibe is probed via `mistral-vibe.*` / `vibe.*` prefixes; if no chat
command is found, clipboard + handoff file still carry the context.

## DesignElementContext

Typed, versioned context passed to agents (v2: selector, tag, styles, text,
instruction). Fields are limited; excludes secrets, form inputs, user data.
Size capped.

## Preview Runtime

The Preview Runtime is an ESM package in `packages/preview-runtime`. For any
project HTML served through Design Studio (`/project/...`) the runtime is
injected automatically — no integration code is needed in the project. If you
run the app through its own dev server (bound via "Dev server…", localhost
only), import the runtime once in the app entry point:

```ts
import "@design-studio/preview-runtime";
```

Runtime behavior:

- Registers document event listeners for hover and selection in edit mode.
- Double-click opens inline text editing (Enter commits, Escape cancels) and
  reports `ds:text-changed`.
- Applies temporary styles and element ops (`ds:apply-op`: `set-text`,
  `delete`, `duplicate`, `move-up`, `move-down`) and acknowledges with
  structured `ds:style-applied` / `ds:op-applied` messages.
- Emits selector candidates for CSS persistence.
- Never collects form values, cookies, localStorage, or secrets.

## Runtime handshake

1. PreviewContainer creates a session nonce when the preview URL changes.
2. After iframe load, it sends `ds:ping`.
3. Runtime responds with `ds:pong` and the same nonce.
4. Parent retries with backoff until success or timeout.
5. Messages from stale iframes are ignored by nonce/session.

## Preview limitations

- Design Studio binds to the **project**: workspace HTML files (served by the
  built-in host) or the project's own localhost dev server. Arbitrary external
  URLs are not loadable.
- A dev server preview still needs the runtime import in the project entry.
- Runtime missing is reported as a distinct state, not success.
