import { hybrid } from "@/lib/bm25";

export type SkillCategory =
  | "video" | "design" | "code" | "email" | "sales" | "research" | "data" | "writing" | "ops" | "general";

const RULES: Array<[SkillCategory, RegExp]> = [
  ["video", /\b(video|reel|reels|shorts?|motion|animation|remotion|ffmpeg|editing|editor|captions?|subtitles?|storyboard|footage|b-?roll|youtube|tiktok|thumbnail)\b/],
  ["design", /\b(design|ui|ux|figma|brand|branding|palette|typography|layout|landing|css|tailwind|logo|mockup|poster)\b/],
  ["code", /\b(code|coding|typescript|javascript|python|react|next\.?js|bug|refactor|api|repo|git|github|test|lint|build|deploy|function|script)\b/],
  ["email", /\b(e-?mails?|gmail|inbox|newsletter|outreach|cold email|follow-?ups?|reply|subject line|mailer)\b/],
  ["sales", /\b(leads?|crm|pipeline|prospects?|sales|outbound|deal|deals|quota|icp|cold call)\b/],
  ["research", /\b(research|sources?|scrape|scraping|market|competitors?|citations?|analysis|investigate|fact-?check)\b/],
  ["data", /\b(spreadsheet|csv|excel|sheets?|chart|dataset|sql|analytics|metrics|report)\b/],
  ["writing", /\b(copywriting|copy|blog|article|essay|content|seo|tone|headline|script|story)\b/],
  ["ops", /\b(calendar|schedule|expenses?|invoice|booking|forms?|browser|automation|workflow|admin|ticket)\b/],
];

/** Which kinds of work does this text talk about? */
export function categoriesOf(text: string, o: { max?: number; min?: number } = {}): SkillCategory[] {
  const t = String(text || "").toLowerCase().slice(0, 6000);
  return RULES.map(([c, re]) => [c, (t.match(new RegExp(re.source, "g")) ?? []).length] as const)
    .filter(([, n]) => n >= (o.min ?? 1))
    .sort((a, b) => b[1] - a[1])
    .slice(0, o.max ?? 3)
    .map(([c]) => c);
}

export type SkillLike = { name: string; description: string; instructions: string; tags?: string[]; disabled?: boolean };
export type SkillMeta = SkillLike & { trial?: boolean; wins?: number; fails?: number; files?: Record<string, string> };

/** A skill needs at least this score (0..~1.3) before its FULL text is put into the prompt. Weaker matches only appear in the index. */
export const SKILL_FULL_MIN = 0.35;

/** Skills scored for a piece of text: hybrid relevance (keywords + fuzzy) + a boost when the skill's type matches the job type. */
export function scoreSkills<T extends SkillLike>(skills: T[], text: string): Array<{ s: T; score: number }> {
  const live = skills.filter((s) => !s.disabled);
  if (!live.length) return [];
  const want = categoriesOf(text);
  const base = new Map<T, number>();
  for (const r of hybrid(live, (s) => `${s.name} ${s.name} ${s.description} ${s.description} ${s.instructions.slice(0, 600)}`, text)) base.set(r.doc, r.score);
  return live
    .map((s) => ({ s, score: (base.get(s) ?? 0) + (s.tags ?? []).filter((t) => want.includes(t as SkillCategory)).length * 0.25 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Best skills for a piece of text. */
export function rankSkillList<T extends SkillLike>(skills: T[], text: string, n = 3): T[] {
  return scoreSkills(skills, text).slice(0, n).map((x) => x.s);
}

/** One short line per skill: this is what stays in the prompt ALL the time (progressive disclosure, like Hermes). */
export function skillIndexLine(s: SkillMeta): string {
  const tag = (s.tags ?? []).slice(0, 3).join("/");
  const stat = s.trial ? " (on trial)" : (s.wins ?? 0) > 0 ? ` (worked ${s.wins}x)` : "";
  const files = s.files && Object.keys(s.files).length ? ` +${Object.keys(s.files).length} files` : "";
  return `- ${s.name}${tag ? ` [${tag}]` : ""}: ${String(s.description ?? "").replace(/\s+/g, " ").slice(0, 150)}${stat}${files}`;
}

/**
 * Prompt block for skills. Index of every live skill (cheap) + the FULL text of only the best 1-2 matches (strong score only).
 * Everything else is loaded on demand with skill.read. `index:false` is for agents that have no skill.read tool.
 */
export function skillsPromptBlock<T extends SkillMeta>(
  skills: T[], text: string, o: { full?: number; fullChars?: number; indexMax?: number; index?: boolean } = {}
): string[] {
  const live = skills.filter((s) => !s.disabled);
  if (!live.length) return [];
  const scored = scoreSkills(live, text);
  const full = scored.filter((x) => x.score >= SKILL_FULL_MIN).slice(0, o.full ?? 2).map((x) => x.s);
  const parts: string[] = [];
  if (full.length) {
    parts.push(
      "SKILLS THAT FIT THIS JOB (follow them closely):\n" +
        full.map((s) => {
          const f = s.files ? Object.keys(s.files) : [];
          return `## ${s.name}\n${s.instructions.slice(0, o.fullChars ?? 3000)}${f.length ? `\n(Supporting files, load with skill.file: ${f.join(", ")})` : ""}`;
        }).join("\n\n")
    );
  }
  if (o.index !== false) {
    const left = live.filter((s) => !full.includes(s));
    if (left.length) {
      const max = o.indexMax ?? 60;
      const shown = left.slice().sort((a, b) => ((b.wins ?? 0) - (a.wins ?? 0))).slice(0, max);
      parts.push(`YOUR OTHER SKILLS (name: what it is for). Load the full text with skill.read before a job that fits one${left.length > max ? ` (${left.length - max} more: use skill.list)` : ""}:\n` + shown.map(skillIndexLine).join("\n"));
    }
  }
  return parts;
}

export function parseSkillMarkdown(text: string): { name: string; description: string; instructions: string } | null {
  const t = String(text || "").trim();
  const m = /^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(t);
  if (m) {
    const get = (k: string) => {
      const r = new RegExp(`^${k}:\\s*(.+)$`, "im").exec(m[1]);
      return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    const name = get("name");
    const body = m[2].trim();
    if (name && body) return { name, description: get("description") || name, instructions: body };
  }
  if (t.length < 60) return null;
  const h = /^#\s+(.+)$/m.exec(t)?.[1]?.trim();
  if (!h) return null;
  const para = t.replace(/^#.*$/m, "").trim().split(/\n\s*\n/)[0] ?? "";
  return { name: h.slice(0, 80), description: para.replace(/\s+/g, " ").slice(0, 200) || h, instructions: t };
}

/** Does this chat message look like "install this skill"? (URL, npx command, pasted SKILL.md ...) */
export function looksLikeSkillInstall(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^\/skills?\s+(install|add)\b/i.test(t)) return true;
  if (/\b(npx|npm|pnpm|bunx)\b[^\n]*\bskills?\b[^\n]*\b(add|install)\b/i.test(t)) return true;
  if (/^---\s*\nname:/i.test(t)) return true;
  const hasUrl = /https?:\/\/\S+/.test(t);
  if (/\b(install|add|save|learn|import|download|setup|set up)\b[\s\S]*\bskills?\b/i.test(t) && (hasUrl || t.length > 300)) return true;
  if (/^https?:\/\/\S+$/.test(t) && /(skill|SKILL\.md)/i.test(t)) return true;
  return false;
}
