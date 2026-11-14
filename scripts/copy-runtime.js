const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "packages", "preview-runtime", "dist");
const publicDir = path.join(root, "webview", "public");

const copies = [
  { from: "index.js", to: "runtime.js" },
  { from: "protocol.js", to: "protocol.js" },
];

if (!fs.existsSync(path.join(dist, "index.js"))) {
  console.error("Runtime bundle not found:", path.join(dist, "index.js"));
  process.exit(1);
}

fs.mkdirSync(publicDir, { recursive: true });
for (const c of copies) {
  const src = path.join(dist, c.from);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(publicDir, c.to);
  fs.copyFileSync(src, dest);
  console.log("Copied", c.from, "to", dest);
}
