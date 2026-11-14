const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const webviewDist = path.join(root, "dist", "webview");
const extensionPath = path.join(root, "dist", "extension.js");
const required = ["index.html", "demo.html", "runtime.js", "protocol.js"];

if (!fs.existsSync(extensionPath) || !fs.statSync(extensionPath).isFile() || fs.statSync(extensionPath).size === 0) {
  console.error("Missing or empty build artifact:", extensionPath);
  process.exit(1);
}

for (const file of required) {
  const full = path.join(webviewDist, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile() || fs.statSync(full).size === 0) {
    console.error("Missing or empty build artifact:", full);
    process.exit(1);
  }
}

const runtime = fs.readFileSync(path.join(webviewDist, "runtime.js"), "utf8");
if (!runtime.includes("Design Studio runtime loaded")) {
  console.error("runtime.js does not contain expected runtime code");
  process.exit(1);
}

const demo = fs.readFileSync(path.join(webviewDist, "demo.html"), "utf8");
if (!demo.includes("runtime.js")) {
  console.error("demo.html does not reference runtime.js");
  process.exit(1);
}

const indexHtml = fs.readFileSync(path.join(webviewDist, "index.html"), "utf8");
const assetRefs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
for (const ref of assetRefs) {
  const relative = ref.replace(/^\/+/, "");
  if (!relative || /^https?:/i.test(relative)) continue;
  const full = path.join(webviewDist, relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile() || fs.statSync(full).size === 0) {
    console.error("Missing referenced webview asset:", ref);
    process.exit(1);
  }
}

console.log("Build artifacts verified: extension.js,", required.join(", "));