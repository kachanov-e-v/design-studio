const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mcpPath = path.join(root, "dist", "mcp-server.js");

if (!fs.existsSync(mcpPath) || !fs.statSync(mcpPath).isFile() || fs.statSync(mcpPath).size === 0) {
  console.error("Missing or empty MCP server artifact:", mcpPath);
  process.exit(1);
}
const source = fs.readFileSync(mcpPath, "utf8");
const requiredToolNames = [
  "get_pending_changes",
  "get_changes_since",
  "acknowledge_changes",
  "get_selected_element",
  "complete_handoff",
  "get_project_state",
];
for (const name of requiredToolNames) {
  if (!source.includes(`"${name}"`)) {
    console.error("MCP server bundle is missing tool:", name);
    process.exit(1);
  }
}
console.log("MCP server artifact verified:", mcpPath);
