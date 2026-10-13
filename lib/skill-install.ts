// Server-only. Installs skills from a URL, a GitHub repo, an "npx skills add" command or pasted text.
import { safeFetch } from "@/lib/tools/net";
import { saveSkillServer } from "@/lib/learning";
import { parseSkillMarkdown } from "@/lib/skills-core";
import { INJECTION_PATTERNS } from "@/lib/shield";

const UA = { "User-Agent": "agenticvenus", Accept: "text/plain, text/markdown, application/vnd.github+json, */*" };
type Ref = { kind: "url"; url: string } | { kind: "repo"; owner: string; name: string; skill?: string };

function toRaw(u: URL): string {
  if (u.hostname === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)\/(blob|tree)\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (m) {
      const path = m[3] === "tree" && !/\.md$/i.test(m[5]) ? `${m[5].replace(/\/$/, "")}/SKILL.md` : m[5];
      return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[4]}/${path}`;
    }
  }
  if (u.hostname === "gist.github.com") return u.toString().replace("gist.github.com", "gist.githubusercontent.com") + "/raw";
  return u.toString();
}

export function refsOf(input: string): Ref[] {
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const add = (r: Ref) => { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); refs.push(r); } };
  const urls = input.match(/https?:\/\/[^\s)>\]"']+/g) ?? [];
  for (const raw of urls.slice(0, 4)) {
    try {
      const u = new URL(raw);
      if (u.hostname === "github.com") {
        const m = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(u.pathname);
        if (m) { add({ kind: "repo", owner: m[1], name: m[2] }); continue; }
      }
      add({ kind: "url", url: toRaw(u) });
    } catch { /* not a URL */ }
  }
  if (!urls.length) {
    const c = /(?:skills?\s+(?:add|install)|npx\s+skills\s+add)\s+([\w.-]+)\/([\w.-]+?)(?:@([\w.-]+))?(?:\s+(?:--skill|-s)\s+([\w.-]+))?(?=\s|$)/i.exec(input);
    if (c) add({ kind: "repo", owner: c[1], name: c[2], skill: c[3] || c[4] });
  }
  return refs;
}

async function getText(url: string, max = 60_000): Promise<string> {
  const r = await safeFetch(url, { headers: UA }, 15_000);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.slice(0, 90)}`);
  return (await r.text()).slice(0, max);
}

async function repoSkillFiles(owner: string, name: string, skill?: string): Promise<Array<{ path: string; text: string }>> {
  const r = await safeFetch(`https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=1`, { headers: UA }, 15_000);
  if (!r.ok) throw new Error(`GitHub repo ${owner}/${name}: HTTP ${r.status}`);
  const j = (await r.json()) as { tree?: Array<{ path: string; type: string }> };
  let paths = (j.tree ?? []).filter((x) => x.type === "blob" && /(^|\/)SKILL\.md$/i.test(x.path)).map((x) => x.path);
  if (skill) paths = paths.filter((p) => p.toLowerCase().includes(skill.toLowerCase()));
  if (!paths.length) throw new Error(`No SKILL.md found in ${owner}/${name}${skill ? ` for "${skill}"` : ""}.`);
  const out: Array<{ path: string; text: string }> = [];
  for (const p of paths.slice(0, 12)) {
    try {
      const enc = p.split("/").map(encodeURIComponent).join("/");
      out.push({ path: p, text: await getText(`https://raw.githubusercontent.com/${owner}/${name}/HEAD/${enc}`) });
    } catch { /* skip this file */ }
  }
  return out;
}

const slugFromUrl = (url: string) => {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "skill";
    return /^skill\.md$/i.test(last) ? parts[parts.length - 2] ?? "skill" : last.replace(/\.\w+$/, "");
  } catch { return "skill"; }
};

const DANGEROUS = new Set(["override-instructions", "secret-exfil", "fake-system", "role-hijack"]);

export async function installFromInput(
  uid: string, chatId: string, input: string, o: { trial?: boolean } = {}
): Promise<{ names: string[]; errors: string[]; flagged: string[] }> {
  const names: string[] = [];
  const errors: string[] = [];
  const flagged: string[] = [];
  const jobs: Array<{ text: string; src: string; hint: string }> = [];
  const refs = refsOf(input);

  for (const r of refs) {
    try {
      if (r.kind === "url") {
        const text = await getText(r.url);
        if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("that page is HTML, not a SKILL.md. Send the GitHub link or paste the skill text.");
        jobs.push({ text, src: r.url, hint: slugFromUrl(r.url) });
      } else {
        for (const f of await repoSkillFiles(r.owner, r.name, r.skill)) {
          jobs.push({ text: f.text, src: `github:${r.owner}/${r.name}/${f.path}`, hint: f.path.split("/").slice(-2, -1)[0] || r.name });
        }
      }
    } catch (e) { errors.push(e instanceof Error ? e.message : "fetch failed"); }
  }
  if (!refs.length && input.trim().length > 60) {
    jobs.push({ text: input.trim().replace(/^\/skills?\s+(?:install|add)\s*/i, ""), src: "pasted", hint: "pasted-skill" });
  }

  for (const j of jobs) {
    const parsed =
      parseSkillMarkdown(j.text) ??
      (j.text.trim().length > 60
        ? { name: j.hint, description: j.text.trim().split("\n")[0].replace(/^#+\s*/, "").slice(0, 200), instructions: j.text.trim() }
        : null);
    if (!parsed) { errors.push(`${j.src}: could not read it as a skill.`); continue; }
    const bad = INJECTION_PATTERNS.filter(([n, re]) => DANGEROUS.has(n) && re.test(j.text)).map(([n]) => n);
    try {
      const sk = await saveSkillServer(uid, chatId, { ...parsed, trial: o.trial ?? false, source: j.src, disabled: bad.length > 0 });
      names.push(bad.length ? `${sk.name} (paused: it contains instruction-like text, review it on the Skills page)` : sk.name);
      if (bad.length) flagged.push(sk.name);
    } catch (e) { errors.push(`${parsed.name}: ${e instanceof Error ? e.message : "could not save"}`); }
  }
  if (!jobs.length && !errors.length) errors.push("I found no skill link, command or text in that message.");
  return { names, errors, flagged };
}