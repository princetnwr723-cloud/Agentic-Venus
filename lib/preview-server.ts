// Server-only. Better codespace preview: (1) instant static bundle, (2) live dev server on port 3000.
import { exec } from "@/lib/e2b-server";
import { startJob } from "@/lib/venus-server";
import { q, wsRoot, type Sb } from "@/lib/code-server";

export const PORT = 3000;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  ico: "image/x-icon", avif: "image/avif", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};
const ext = (p: string) => (p.split(".").pop() ?? "").toLowerCase();
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function resolveRef(baseDir: string, u: string): string | null {
  const raw = u.trim();
  if (!raw || /^(https?:|data:|\/\/|#|mailto:|tel:|javascript:|blob:)/i.test(raw)) return null;
  let clean = raw.split("?")[0].split("#")[0];
  try { clean = decodeURIComponent(clean); } catch { /* keep as is */ }
  const parts = (clean.startsWith("/") ? clean.slice(1) : (baseDir ? baseDir + "/" : "") + clean).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") { if (!out.length) return null; out.pop(); } else out.push(p);
  }
  const r = out.join("/");
  return r && !r.startsWith(".git/") && !r.startsWith("node_modules/") ? r : null;
}

/** Reads many workspace files in ONE round trip (base64, size-capped). */
async function readMany(sb: Sb, root: string, rels: string[], maxBytes: number): Promise<Map<string, Buffer>> {
  const map = new Map<string, Buffer>();
  if (!rels.length) return map;
  const cmd = `cd ${q(root)} && for f in ${rels.map(q).join(" ")}; do if [ -f "$f" ]; then s=$(stat -c %s "$f"); if [ "$s" -le ${maxBytes} ]; then printf '@@%s\\n' "$f"; base64 -w0 "$f"; printf '\\n'; fi; fi; done`;
  const r = await exec(sb, cmd, 30_000);
  let cur = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("@@")) cur = line.slice(2);
    else if (cur && line.trim()) { map.set(cur, Buffer.from(line.trim(), "base64")); cur = ""; }
  }
  return map;
}

const URL_SRC = "url\\(\\s*([\"']?)([^\"')]+)\\1\\s*\\)";
const attr = (tag: string, name: string) => new RegExp("\\b" + name + "=[\"']([^\"']+)[\"']", "i").exec(tag)?.[1];

// Makes localStorage work inside the sandboxed preview, and lets links between local pages work.
const SHIM = `<script>(function(){var mk=function(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch(_){}}});document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(/^(https?:|mailto:|tel:|#|javascript:)/i.test(h))return;e.preventDefault();parent.postMessage({venusNav:h},"*")},true)})();</script>`;

export type Bundle = { html: string; entry: string; files: string[]; hasPackage: boolean };

export async function bundleHtml(sb: Sb, ws: string, entry?: string): Promise<Bundle> {
  const root = wsRoot(ws);
  const l = await exec(
    sb,
    `cd ${q(root)} 2>/dev/null && { find . -maxdepth 4 -name '*.html' -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' -not -path './dist/*' -not -path './build/*' | sed 's|^\\./||' | head -60; test -f package.json && echo '@@PKG'; }`,
    15_000
  );
  const lines = l.stdout.split("\n").filter(Boolean);
  const hasPackage = lines.includes("@@PKG");
  const files = lines.filter((x) => x !== "@@PKG").sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const pick = entry && files.includes(entry) ? entry : files.includes("index.html") ? "index.html" : files[0];
  if (!pick) return { html: "", entry: "", files, hasPackage };

  const dir = dirOf(pick);
  let html = (await readMany(sb, root, [pick], 1_500_000)).get(pick)?.toString("utf8") ?? "";
  if (!html) return { html: "", entry: pick, files, hasPackage };

  // ---- round 1: everything the HTML references
  const want = new Set<string>();
  const add = (u: string | undefined, base: string) => { const r = u ? resolveRef(base, u) : null; if (r) want.add(r); return r; };
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const t of links) add(attr(t, "href"), dir);
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi)) add(m[1], dir);
  for (const t of html.match(/<(?:img|source|video|audio)\b[^>]*>/gi) ?? []) { add(attr(t, "src"), dir); add(attr(t, "poster"), dir); }
  for (const m of html.matchAll(new RegExp(URL_SRC, "g"))) add(m[2], dir);
  const all = await readMany(sb, root, Array.from(want).slice(0, 80), 1_500_000);

  // ---- round 2: url(...) inside the CSS files (fonts, images)
  const want2 = new Set<string>();
  for (const t of links) {
    if (!/rel=["'][^"']*stylesheet/i.test(t)) continue;
    const p = resolveRef(dir, attr(t, "href") ?? "");
    const css = p ? all.get(p)?.toString("utf8") : undefined;
    if (!p || !css) continue;
    for (const m of css.matchAll(new RegExp(URL_SRC, "g"))) {
      const r = resolveRef(dirOf(p), m[2]);
      if (r && !all.has(r)) want2.add(r);
    }
  }
  for (const [k, v] of await readMany(sb, root, Array.from(want2).slice(0, 60), 1_500_000)) all.set(k, v);

  let budget = 3_000_000;
  const dataUri = (p: string): string | null => {
    const mime = MIME[ext(p)];
    const b = all.get(p);
    if (!mime || !b) return null;
    const s = b.toString("base64");
    if (s.length > budget) return null;
    budget -= s.length;
    return `data:${mime};base64,${s}`;
  };
  const rewrite = (text: string, base: string) =>
    text.replace(new RegExp(URL_SRC, "g"), (full, _q: string, u: string) => {
      const r = resolveRef(base, u);
      const d = r ? dataUri(r) : null;
      return d ? `url(${d})` : full;
    });

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = attr(tag, "href");
    const p = href ? resolveRef(dir, href) : null;
    if (!p) return tag;
    if (/rel=["'][^"']*stylesheet/i.test(tag)) {
      const css = all.get(p)?.toString("utf8");
      return css ? `<style>${rewrite(css, dirOf(p))}</style>` : tag;
    }
    if (/rel=["'][^"']*icon/i.test(tag)) {
      const d = dataUri(p);
      return d ? tag.replace(href as string, d) : tag;
    }
    return tag;
  });
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (full, pre: string, src: string, post: string) => {
    const p = resolveRef(dir, src);
    const js = p ? all.get(p)?.toString("utf8") : undefined;
    return js ? `<script ${pre} ${post}>${js.replace(/<\/script/gi, "<\\/script")}</script>` : full;
  });
  html = html.replace(/<(?:img|source|video|audio)\b[^>]*>/gi, (tag) =>
    tag.replace(/\b(src|poster)=(["'])([^"']+)\2/gi, (full, a: string, qt: string, u: string) => {
      const r = resolveRef(dir, u);
      const d = r ? dataUri(r) : null;
      return d ? `${a}=${qt}${d}${qt}` : full;
    })
  );
  html = rewrite(html, dir);
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + SHIM) : SHIM + html;

  return { html, entry: pick, files, hasPackage };
}

// ---------------- live dev server ----------------

export async function startServe(sb: Sb, ws: string) {
  const root = wsRoot(ws);
  const script = `cd ${q(root)}
fuser -k ${PORT}/tcp >/dev/null 2>&1 || true
pkill -f 'http.server ${PORT}' >/dev/null 2>&1 || true
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.e2b.app HOST=0.0.0.0 BROWSER=none CI=1
if [ -f package.json ] && grep -q '"dev"' package.json; then
  [ -d node_modules ] || npm install --no-audit --no-fund
  if grep -q '"next"' package.json; then exec npx next dev -H 0.0.0.0 -p ${PORT}
  elif grep -q '"vite"' package.json; then exec npx vite --host 0.0.0.0 --port ${PORT}
  else PORT=${PORT} exec npm run dev; fi
elif [ -f package.json ] && grep -q '"start"' package.json; then
  [ -d node_modules ] || npm install --no-audit --no-fund
  PORT=${PORT} exec npm start
else
  exec python3 -m http.server ${PORT} --bind 0.0.0.0
fi
`;
  await startJob(sb, "serve", script);
}

export async function serveStatus(sb: Sb): Promise<{ ready: boolean; exited: boolean; url: string | null; log: string }> {
  const r = await exec(
    sb,
    `curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PORT}/ ; echo
cat /tmp/jobs/serve.exit 2>/dev/null; echo
echo ---
tail -c 1500 /tmp/jobs/serve.log 2>/dev/null`,
    15_000
  );
  const idx = r.stdout.indexOf("---\n");
  const head = (idx >= 0 ? r.stdout.slice(0, idx) : r.stdout).split("\n");
  const code = (head[0] ?? "").trim();
  const exited = (head[1] ?? "").trim() !== "";
  const log = (idx >= 0 ? r.stdout.slice(idx + 4) : "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
  let url: string | null = null;
  try {
    const host = (sb as unknown as { getHost?: (p: number) => string }).getHost?.(PORT);
    if (host) url = `https://${host}`;
  } catch { /* ignore */ }
  return { ready: /^[1-4]\d\d$/.test(code), exited, url, log };
}

export async function stopServe(sb: Sb) {
  await exec(sb, `fuser -k ${PORT}/tcp >/dev/null 2>&1 || true; pkill -f 'http.server ${PORT}' >/dev/null 2>&1 || true; true`, 15_000);
}