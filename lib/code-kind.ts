// Venus Code: which KIND of project is this, and how can the owner SEE it?  (pure functions, no server code, no imports of values)
//
//   html    -> "instant"  : the page appears at once in the Preview tab, nothing needs to be connected
//   node    -> "live"     : the dev server of the computer (Next.js, Vite, npm run dev), nothing needs to be connected
//   python / php / go / ruby web apps -> "vercel": the preview is a real deployment on Vercel, so the owner connects a Vercel token FIRST
//   java / rust / c / c++ / c# / kotlin / swift / ... -> "run": Vercel cannot host them; they run on the computer and the output is shown
export type PreviewMode = "instant" | "live" | "vercel" | "run";

export type ProjectKind = {
  id: string;
  label: string;
  mode: PreviewMode;
  /** how Vercel can run it: native (its own runtime), adapter (Venus adds the small glue files), none */
  vercel: "native" | "adapter" | "none";
  note: string;
};

const IGNORED = /(^|\/)(node_modules|\.git|\.next|dist|build|\.venv|venv|__pycache__|target|vendor|\.vercel)(\/|$)/;
const clean = (files: string[]) => files.map((f) => String(f).replace(/^\.\//, "")).filter((f) => f && !IGNORED.test(f));

export function detectProject(rawFiles: string[]): ProjectKind {
  const files = clean(rawFiles);
  const has = (re: RegExp) => files.some((f) => re.test(f));
  const html = has(/\.html?$/i);

  // ---- Node / JavaScript: the live dev server of the computer (works today, needs no key)
  if (has(/^package\.json$/)) {
    return { id: "node", label: "Node / JavaScript app", mode: "live", vercel: "native", note: "Runs as a live server on the computer: open the Live server tab." };
  }

  // ---- web apps in other languages: the preview is a Vercel deployment
  if (has(/\.py$/) && (has(/^(requirements\.txt|pyproject\.toml|Pipfile)$/) || has(/(^|\/)(app|main|index|server|wsgi|asgi|application|manage)\.py$/))) {
    const django = has(/(^|\/)manage\.py$/);
    return { id: django ? "python-django" : "python", label: django ? "Python (Django)" : "Python (Flask / FastAPI)", mode: "vercel", vercel: "adapter", note: "Previewed on Vercel (Python runtime)." };
  }
  if (has(/\.php$/)) {
    return { id: "php", label: "PHP", mode: "vercel", vercel: "adapter", note: "Previewed on Vercel through the community PHP runtime (experimental)." };
  }
  if (has(/^api\/[^/]+\.go$/)) {
    return { id: "go", label: "Go (serverless functions)", mode: "vercel", vercel: "native", note: "Previewed on Vercel: each file in api/ is a Go function." };
  }
  if (has(/^api\/[^/]+\.rb$/)) {
    return { id: "ruby", label: "Ruby (serverless functions)", mode: "vercel", vercel: "native", note: "Previewed on Vercel: each file in api/ is a Ruby function." };
  }

  // ---- plain HTML
  if (html && !has(/\.(py|php|go|rb|java|rs|cs|kt|swift|dart|ex|exs|hs|zig|c|cc|cpp|cxx)$/i)) {
    return { id: "html", label: "HTML website", mode: "instant", vercel: "native", note: "Shows instantly in the Preview tab." };
  }

  // ---- languages that run on the computer only
  const runOnly: Array<[string, string, RegExp]> = [
    ["java", "Java", /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$|\.java$/],
    ["kotlin", "Kotlin", /\.kt$/],
    ["rust", "Rust", /(^|\/)Cargo\.toml$|\.rs$/],
    ["csharp", "C# / .NET", /\.(csproj|sln|cs)$/],
    ["cpp", "C / C++", /(^|\/)CMakeLists\.txt$|\.(c|cc|cpp|cxx|h|hpp)$/],
    ["swift", "Swift", /(^|\/)Package\.swift$|\.swift$/],
    ["dart", "Dart / Flutter", /(^|\/)pubspec\.yaml$|\.dart$/],
    ["elixir", "Elixir", /(^|\/)mix\.exs$|\.exs?$/],
    ["haskell", "Haskell", /\.(hs|cabal)$/],
    ["zig", "Zig", /\.zig$/],
    ["go", "Go", /(^|\/)go\.mod$|\.go$/],
    ["ruby", "Ruby", /(^|\/)Gemfile$|\.rb$/],
    ["python", "Python", /\.py$/],
    ["lua", "Lua", /\.lua$/],
    ["perl", "Perl", /\.pl$/],
    ["r", "R", /\.R$/],
    ["shell", "Shell", /\.sh$/],
  ];
  for (const [id, label, re] of runOnly) {
    if (has(re)) {
      return { id, label, mode: "run", vercel: "none", note: `${label} runs on the computer (see the Terminal tab). Vercel cannot host it as it is: ask for a small HTML page (or an api/ function for Go, Ruby, Python) if you want a visual preview.` };
    }
  }
  if (html) return { id: "html", label: "HTML website", mode: "instant", vercel: "native", note: "Shows instantly in the Preview tab." };
  return { id: "empty", label: "Empty project", mode: "instant", vercel: "native", note: "Nothing to preview yet." };
}

// ---------------------------------------------------------------------------------------------------------
// What the owner ASKED for (chat message): does the preview of it need a Vercel token before the agent starts?
// ---------------------------------------------------------------------------------------------------------
const WEB_INTENT = /\b(web\s?app|webapp|website|web\s?site|site|api|rest|endpoint|backend|back-end|server|dashboard|landing|portal|saas|app|application|flask|fastapi|django|laravel|rails|sinatra|slim|symfony)\b/i;
const SCRIPT_ONLY = /\b(script|cli|command[\s-]?line|scraper|bot|automation|notebook|algorithm|leetcode|dsa|homework|assignment|tkinter|pygame|desktop)\b/i;
const LANGS: Array<[string, RegExp]> = [
  ["Python", /\b(python|flask|fastapi|django|py)\b/i],
  ["PHP", /\b(php|laravel|symfony|wordpress)\b/i],
  ["Go", /\b(golang|go\s?lang|go\s(?:app|api|server|backend|web))\b/i],
  ["Ruby", /\b(ruby|rails|sinatra)\b/i],
];

/** The language (Python, PHP, Go, Ruby) when the request is for a WEB app in it, which can only be previewed on Vercel; otherwise null. */
export function vercelNeeded(instruction: string): string | null {
  const t = String(instruction ?? "");
  if (t.length < 4) return null;
  if (/\b(no|without|bina|skip)\s+(preview|vercel)\b/i.test(t)) return null;
  const lang = LANGS.find(([, re]) => re.test(t));
  if (!lang) return null;
  if (!WEB_INTENT.test(t) || (SCRIPT_ONLY.test(t) && !/\b(flask|fastapi|django|laravel|rails|api|website|webapp|web app)\b/i.test(t))) return null;
  // a request that is clearly a static page in HTML needs nothing
  if (/\b(html|css)\b/i.test(t) && !/\b(flask|fastapi|django|laravel|rails|python|php|api|backend)\b/i.test(t)) return null;
  return lang[0];
}

export const SKIP_PREVIEW_RE = /^\s*(skip|skip it|skip preview|no preview|without preview|bina preview|preview nahi|nahi chahiye|rehne do|reh do|baad me|later)\b/i;

/** "connect vercel vcp_xxx", "vercel token: xxxxxxxx", or a bare vcp_ token: returns the token. */
export function vercelTokenIntent(raw: string, waiting = false): string | null {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 220 || t.includes("\n")) return null;
  const mentions = /vercel/i.test(t);
  const m = /\b(vcp_[A-Za-z0-9_-]{16,}|[A-Za-z0-9]{24,40})\b/.exec(t.replace(/vercel/gi, " "));
  if (!m) return null;
  const tok = m[1];
  const mixed = /\d/.test(tok) && /[A-Za-z]/.test(tok);
  if (!mixed) return null;
  if (mentions) return tok;
  // no word "vercel": only a bare token that starts like a Vercel one, or any lone token while the agent is waiting for it
  if (t === tok && (tok.startsWith("vcp_") || waiting)) return tok;
  return null;
}