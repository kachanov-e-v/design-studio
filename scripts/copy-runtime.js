const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "packages", "preview-runtime", "dist");
const publicDir = path.join(root, "webview", "public");

const copies = [
  { from: "index.js", to: "runtime.js" },
  { from: "protocol.js", to: "protocol.js" },
];

for (const c of copies) {
  const src = path.join(dist, c.from);
  if (!fs.existsSync(src)) {
    console.error("Required runtime artifact not found:", src);
    process.exit(1);
  }
  const stat = fs.statSync(src);
  if (!stat.isFile() || stat.size === 0) {
    console.error("Required runtime artifact is empty:", src);
    process.exit(1);
  }
}

fs.mkdirSync(publicDir, { recursive: true });
for (const c of copies) {
  const src = path.join(dist, c.from);
  const dest = path.join(publicDir, c.to);
  fs.copyFileSync(src, dest);
  console.log("Copied", c.from, "to", dest);
}