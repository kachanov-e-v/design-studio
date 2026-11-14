const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const webviewDist = path.join(root, "dist", "webview");
const required = ["index.html", "demo.html", "runtime.js", "protocol.js"];

for (const file of required) {
  const full = path.join(webviewDist, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile() || fs.statSync(full).size === 0) {
    console.error("Missing or empty build artifact:", full);
    process.exit(1);
  }
}

const runtime = fs.readFileSync(path.join(webviewDist, "runtime.js"), "utf8");
if (!runtime.includes("./protocol.js")) {
  console.error("runtime.js does not reference ./protocol.js");
  process.exit(1);
}

const demo = fs.readFileSync(path.join(webviewDist, "demo.html"), "utf8");
if (!demo.includes("runtime.js")) {
  console.error("demo.html does not reference runtime.js");
  process.exit(1);
}

console.log("Build artifacts verified:", required.join(", "));