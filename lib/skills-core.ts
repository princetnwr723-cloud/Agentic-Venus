import { bm25 } from "@/lib/bm25";

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

/** Best skills for a piece of text: keyword relevance (BM25) + a boost when the skill's type matches the job type. */
export function rankSkillList<T extends SkillLike>(skills: T[], text: string, n = 3): T[] {
  const live = skills.filter((s) => !s.disabled);
  if (!live.length) return [];
  const want = categoriesOf(text);
  const base = new Map<T, number>();
  for (const r of bm25(live, (s) => `${s.name} ${s.name} ${s.description} ${s.instructions.slice(0, 600)}`, text)) base.set(r.doc, r.score);
  return live
    .map((s) => ({ s, score: (base.get(s) ?? 0) + (s.tags ?? []).filter((t) => want.includes(t as SkillCategory)).length * 2 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.s);
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