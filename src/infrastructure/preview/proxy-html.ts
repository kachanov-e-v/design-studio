const RUNTIME_SCRIPT_ATTRS = ` data-design-studio="1" defer`;

export function proxyPathFor(targetUrl: string): string {
  return `/proxy/${targetUrl}`;
}

export function targetFromProxyPath(rawPath: string): string | null {
  const raw = rawPath.startsWith("/proxy/") ? rawPath.slice("/proxy/".length) : rawPath;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Fallback proxy targeting: requests that bypassed /proxy/ rewriting (SPA
 * router fetches, window.location redirects) still carry the proxied document
 * URL in Referer. Extract the target origin from it and keep the request path.
 */
export function targetFromReferer(referer: string | undefined, requestPath: string): string | null {
  if (!referer) return null;
  const m = /\/proxy\/(https?:\/\/[^/]+)/.exec(referer);
  if (!m || !m[1]) return null;
  try {
    const idx = requestPath.indexOf("?");
    const pathname = idx === -1 ? requestPath : requestPath.slice(0, idx);
    const search = idx === -1 ? "" : requestPath.slice(idx);
    const u = new URL(`${pathname}${search || ""}`, m[1]);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Dev servers often bind to 127.0.0.1 or ::1 only; try the alternate loopback form. */
export function candidateLoopbackTargets(target: string): string[] {
  const candidates = [target];
  try {
    const u = new URL(target);
    const other =
      u.hostname === "localhost" ? "127.0.0.1" : u.hostname === "127.0.0.1" ? "localhost" : null;
    if (other) {
      const port = u.port ? `:${u.port}` : "";
      candidates.push(`${u.protocol}//${other}${port}${u.pathname}${u.search}`);
    }
  } catch {
    // ignore
  }
  return candidates;
}

export function buildInjectedHead(runtimeUrl: string, baseHref: string): string {
  return `<base href="${baseHref}">` + `<script src="${runtimeUrl}"${RUNTIME_SCRIPT_ATTRS}></script>`;
}

export function injectIntoHtml(html: string, runtimeUrl: string, baseHref: string): string {
  const injection = buildInjectedHead(runtimeUrl, baseHref);
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + injection + html.slice(at);
  }
  const bodyMatch = /<body[^>]*>/i.exec(html);
  if (bodyMatch) {
    const at = bodyMatch.index + bodyMatch[0].length;
    return html.slice(0, at) + injection + html.slice(at);
  }
  return injection + html;
}

function rewriteCssUrls(css: string, proxyPrefix: string): string {
  return css.replace(/url\(\s*(['"]?)\/(?!\/)/g, (_m, q: string) => `url(${q}${proxyPrefix}/`);
}

function targetOriginPrefix(finalTargetUrl: string): string {
  try {
    return `/proxy/${new URL(finalTargetUrl).origin}`;
  } catch {
    return "/proxy";
  }
}

export function prependProxyOriginToPathUrls(content: string, proxyPrefix: string): string {
  return rewriteCssUrls(content, proxyPrefix);
}

export function rewriteProxiedHtml(html: string, finalTargetUrl: string, runtimeUrl: string, proxyOrigin: string): string {
  const prefix = targetOriginPrefix(finalTargetUrl);
  let out = injectIntoHtml(html, runtimeUrl, `${proxyOrigin}/proxy/${finalTargetUrl}`);
  // Root-absolute attribute values (href/src/action) are intentionally left
  // untouched: rewriting them desynchronizes SSR markup from what React
  // renders on the client (hydration mismatch). Same-origin bare paths are
  // covered instead by the Referer fallback on the preview host and by the
  // injected service worker.
  const styleBlock = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
  out = out.replace(styleBlock, (m, open: string, css: string, close: string) =>
    open + rewriteCssUrls(css, prefix) + close
  );
  const swSnippet = `<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/__ds-sw.js',{scope:'/'}).catch(function(){})})}</script>`;
  out = injectBeforeCloseHead(out, swSnippet);
  return out;
}

function injectBeforeCloseHead(html: string, snippet: string): string {
  const closeHead = /<\/head>/i.exec(html);
  if (closeHead) {
    const at = closeHead.index;
    return html.slice(0, at) + snippet + html.slice(at);
  }
  return html + snippet;
}

export function rewriteProxiedCss(css: string, finalTargetUrl: string): string {
  return rewriteCssUrls(css, targetOriginPrefix(finalTargetUrl));
}

export const HEADERS_TO_STRIP = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "clear-site-data",
  "strict-transport-security",
  "permissions-policy",
  "content-encoding",
  "content-length",
  "transfer-encoding",
] as const;

/** Service worker injected into proxied pages: re-routes same-origin requests (all methods) through the proxy. */
export const DS_SERVICE_WORKER = `
self.addEventListener("install", function (event) { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var p = url.pathname;
  if (p.indexOf("/proxy/") === 0 || p === "/__ds-runtime.js" || p === "/__ds-sw.js" || p === "/demo.html" || p.indexOf("/project/") === 0) return;
  event.respondWith(
    self.clients.get(event.clientId).then(function (client) {
      var prefix = null;
      if (client) {
        var m = /\\/proxy\\/https?:\\/\\/[^/]+/.exec(client.url);
        if (m) prefix = m[0];
      }
      if (!prefix) return fetch(req);
      var rewritten = prefix + p + url.search;
      // The original request cannot be copied wholesale: constructing a
      // Request from a navigate-mode request throws ("Cannot construct a
      // Request"), and a stream body with the copied content-length header
      // fails mid-flight. Snapshot the body as a Blob instead; the browser
      // recomputes content-length from it.
      return req.blob().then(function (blob) {
        var init = {
          method: req.method,
          headers: req.headers,
          credentials: req.credentials,
          cache: req.cache,
          integrity: req.integrity,
          keepalive: req.keepalive
        };
        init.redirect = req.mode === "navigate" ? "follow" : req.redirect;
        if (req.method !== "GET" && req.method !== "HEAD") init.body = blob;
        return fetch(rewritten, init);
      }).catch(function (e) {
        return new Response("DS SW fetch error: " + (e && e.message), { status: 598 });
      });
    })
  );
});
`;
