// Venus Code: makes a project of another language deployable on Vercel (the glue files only; the owner's code is never changed).
//   python  -> api/index.py (imports the app of the project) + vercel.json (everything goes to it) + requirements.txt when it is missing
//   php     -> api/index.php + vercel.json with the community PHP runtime
//   go, ruby -> nothing to add: Vercel runs the files of api/ as they are
// Pure functions on {file, base64 data}: they run in the deploy route and in the tests.
import type { ProjectKind } from "@/lib/code-kind";

export type DeployFile = { file: string; data: string; encoding: "base64" };
export type Prepared = { files: DeployFile[]; added: string[]; warning?: string };

const text = (f: DeployFile | undefined): string => (f ? Buffer.from(f.data, "base64").toString("utf8") : "");
const put = (files: DeployFile[], file: string, content: string): DeployFile[] => [...files.filter((f) => f.file !== file), { file, data: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" }];

const PY_ENTRIES = ["app.py", "main.py", "index.py", "server.py", "application.py", "wsgi.py", "asgi.py"];

export function prepareForVercel(input: DeployFile[], kind: Pick<ProjectKind, "id">): Prepared {
  let files = input;
  const added: string[] = [];
  const has = (p: string) => files.some((f) => f.file === p);
  const add = (p: string, c: string) => { files = put(files, p, c); added.push(p); };
  let warning: string | undefined;

  if (kind.id === "python" || kind.id === "python-django") {
    if (!has("api/index.py")) {
      let wrapper = "";
      if (kind.id === "python-django") {
        const wsgi = files.map((f) => f.file).find((f) => /^[^/]+\/wsgi\.py$/.test(f));
        if (wsgi) {
          const pkg = wsgi.split("/")[0];
          wrapper = `import os, sys\nsys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "${pkg}.settings")\nfrom ${pkg}.wsgi import application as app  # noqa: E402\n`;
        } else warning = "Django project without a wsgi.py: the preview may not start.";
      } else {
        const entry = PY_ENTRIES.find((e) => has(e));
        if (entry) {
          const mod = entry.replace(/\.py$/, "");
          const src = text(files.find((f) => f.file === entry));
          const name = /^\s*app\s*=|^\s*def\s+app\b/m.test(src) ? "app" : /^\s*application\s*=/m.test(src) ? "application" : "app";
          wrapper = `import os, sys\nsys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\nfrom ${mod} import ${name} as app  # noqa: E402\n`;
        } else warning = "No app.py / main.py found: add one that exposes a variable called app.";
      }
      if (wrapper) add("api/index.py", wrapper);
    }
    if (!has("vercel.json")) add("vercel.json", JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/api/index" }] }, null, 2) + "\n");
    if (!has("requirements.txt") && !has("pyproject.toml")) {
      const code = files.filter((f) => f.file.endsWith(".py")).map(text).join("\n");
      const need = ["flask", "fastapi", "django"].filter((m) => new RegExp(`^\\s*(from|import)\\s+${m}\\b`, "mi").test(code));
      add("requirements.txt", (need.length ? need : ["flask"]).join("\n") + "\n");
    }
  } else if (kind.id === "php") {
    if (!has("api/index.php")) {
      const root = files.find((f) => f.file === "index.php");
      add("api/index.php", root ? "<?php\nrequire __DIR__ . '/../index.php';\n" : "<?php\necho 'Hello from PHP on Vercel';\n");
    }
    if (!has("vercel.json")) add("vercel.json", JSON.stringify({ functions: { "api/*.php": { runtime: "vercel-php@0.7.3" } }, routes: [{ src: "/(.*)", dest: "/api/index.php" }] }, null, 2) + "\n");
  }
  return { files, added, ...(warning ? { warning } : {}) };
}