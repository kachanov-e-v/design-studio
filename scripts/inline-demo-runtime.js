const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const demoPath = path.join(root, "webview", "public", "demo.html");
const runtimePath = path.join(root, "dist", "webview", "runtime.js");

let demo = fs.readFileSync(demoPath, "utf8");
const runtime = fs.readFileSync(runtimePath, "utf8");

// Find the opening body tag
const bodyOpenIndex = demo.indexOf("<body>");
if (bodyOpenIndex !== -1) {
  // Find everything after <body>
  const afterBody = demo.substring(bodyOpenIndex + 6); // 6 = length of "<body>"
  
  // Find the closing body tag
  const bodyCloseIndex = afterBody.indexOf("</body>");
  if (bodyCloseIndex !== -1) {
    // Get content before closing body tag
    const bodyContent = afterBody.substring(0, bodyCloseIndex);
    
    // Replace all script tags that load runtime.js
    const bodyContentWithoutScripts = bodyContent.replace(
      /<script>\s*\(function\(\) \{[\s\S]*?\}\(\);<\/script>/, 
      ""
    );
    
    // Rebuild the HTML
    demo = demo.substring(0, bodyOpenIndex + 6) + bodyContentWithoutScripts;
  }
}

// Add the runtime inline
demo += `\n<script>\n${runtime}\n</script>\n</body>\n</html>`;

fs.writeFileSync(demoPath, demo, "utf8");
console.log("demo.html updated with inline runtime");
