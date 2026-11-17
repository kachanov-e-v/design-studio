const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distDemoPath = path.join(root, "dist", "webview", "demo.html");
const runtimePath = path.join(root, "dist", "webview", "runtime.js");

const START = "<!--design-studio:inline-runtime-start-->";
const END = "<!--design-studio:inline-runtime-end-->";

let demo = fs.readFileSync(distDemoPath, "utf8");
const runtime = fs.readFileSync(runtimePath, "utf8");
if (runtime.trim().length === 0) {
  console.error("runtime.js is empty; run npm run build:runtime first");
  process.exit(1);
}

// Drop any previously inlined runtime region.
const startIdx = demo.indexOf(START);
if (startIdx !== -1) {
  const endIdx = demo.indexOf(END);
  if (endIdx === -1) {
    demo = demo.slice(0, startIdx);
  } else {
    demo = demo.slice(0, startIdx) + demo.slice(endIdx + END.length);
  }
}

const closeIdx = demo.indexOf("</body>");
if (closeIdx === -1) {
  console.error("dist/webview/demo.html has no </body> tag");
  process.exit(1);
}

const inlined =
  demo.slice(0, closeIdx) + START + '\n<script data-design-studio="1">\n' + runtime + "\n</script>\n" + END + "\n" + demo.slice(closeIdx);
fs.writeFileSync(distDemoPath, inlined, "utf8");
console.log("demo.html inlined with runtime bundle");
