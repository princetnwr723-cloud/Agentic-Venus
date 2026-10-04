import { getModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import type { PcStatus, AgentRequest } from "@/components/dashboard/PcPanel";

export async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` }; }
}

export function defaultProviderAndModel(apiKeys: Partial<Record<ProviderId, string>>): { provider: ProviderId; model: string } {
  const pref = getModelPref();
  if (pref && apiKeys[pref.provider]) return pref;
  const found = PROVIDERS.find((p) => apiKeys[p.id]);
  const provider = found?.id ?? PROVIDERS[0].id;
  return { provider, model: providerMeta(provider).models[0] };
}

export const normSite = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type PcSession = { status: PcStatus; error: string | null; screenUrl: string | null; steps: string[]; running: boolean; request: AgentRequest | null };
export const EMPTY_SESSION: PcSession = { status: "idle", error: null, screenUrl: null, steps: [], running: false, request: null };
export const IDLE_PAUSE_MS = 50 * 60 * 1000;
export const RUN_CYCLE_MS = 55 * 60 * 1000;

export type Cmd = { cmd: "start" | "stop" | "task" | "venus" | "code" | "skill" | "memory" | "team" | "deploy"; arg?: string };

export function extractCommands(text: string): { clean: string; cmds: Cmd[] } {
  const cmds: Cmd[] = [];
  const clean = text
    .replace(/\[\[(PC|VENUS|CODE|SKILL|MEMORY|TEAM|DEPLOY):([\s\S]*?)\]\]/gi, (_m, tag: string, inner: string) => {
      const t = String(inner).trim();
      const T = tag.toUpperCase();
      if (T === "VENUS" && t) cmds.push({ cmd: "venus", arg: t });
      else if (T === "CODE" && t) cmds.push({ cmd: "code", arg: t });
      else if (T === "TEAM" && t) cmds.push({ cmd: "team", arg: t });
      else if (T === "DEPLOY") cmds.push({ cmd: "deploy", arg: t });
      else if (T === "SKILL") cmds.push({ cmd: "skill", arg: t.replace(/^install\s*\|?\s*/i, "") });
      else if (T === "MEMORY") cmds.push({ cmd: "memory", arg: t });
      else if (T === "PC") {
        const lower = t.toLowerCase();
        if (lower === "start" || lower === "stop") cmds.push({ cmd: lower as "start" | "stop" });
        else {
          const mm = /^task\s*[|:]\s*([\s\S]*)$/i.exec(t);
          const arg = (mm ? mm[1] : t.replace(/^\|/, "")).trim();
          if (arg) cmds.push({ cmd: "task", arg });
        }
      }
      return "";
    })
    .trim();
  return { clean, cmds };
}

export const PC_PROMPT = `

You work through tools that you trigger by ending your reply with tags (never explain the tag syntax to the user; only use a tag when it is really needed):
- Cloud computer (browser + terminal; finds and downloads files/assets). It works in the BACKGROUND, so the user can close the tab: [[PC:task|<clear, complete instruction>]]. Turn it on: [[PC:start]]. Shut it down (everything stays saved): [[PC:stop]].
- Coding (build or change websites/apps/scripts; debug): [[CODE:<detailed instruction>]] — Venus Code. Every chat has ONE codespace; continue in it.
- Motion-graphics video, reel, animation: [[VENUS:<detailed brief: topic, key points, tone, length in seconds, format 16:9, 9:16 or 1:1>]].
- A big goal that spans several areas (e.g. build a site AND find leads AND email them): [[TEAM:<the full goal with every detail>]] — Chief assembles specialists and they work in parallel.
- Save a durable fact about the user: [[MEMORY:add|<fact>]]. Forget something: [[MEMORY:forget|<keyword>]].
- Install a skill the user shared (link or pasted text): [[SKILL:install|<link or text>]].
The computer agent asks the user itself for logins, approvals and one-time codes, so never ask for passwords in chat.`;

export const DEPLOY_PROMPT = `

Deploy: when the user wants their site/app live, end your reply with [[DEPLOY:]] (optionally a project name after the colon). The link is posted in chat automatically.`;

const PC_WORDS = new Set(["pc", "computer", "desktop", "sandbox", "comp", "system"]);
const START_WORDS = ["on", "start", "chalu", "chalao", "chala", "resume", "wake", "open", "kholo", "khol", "shuru", "launch", "boot"];
const STOP_WORDS = ["off", "stop", "shutdown", "pause", "close", "band", "bandh", "bund", "sleep"];
const FILLER = new Set(["ko", "kro", "kr", "karo", "kar", "karna", "kardo", "do", "de", "dena", "please", "plz", "pls", "the", "my", "apna", "apne", "mera", "meri", "ka", "ki", "ke", "liye", "ek", "bhai", "bro", "yrr", "yaar", "ab", "abhi", "now", "it", "hai", "hain", "hoga", "then", "phir", "fir", "and", "aur", "air", "se", "me", "mein", "par", "pe", "na", "to", "hi", "bhi", "a", "i"]);

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else { if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; } }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const isWordOf = (w: string, list: string[]) => list.includes(w) || (w.length >= 4 && list.some((x) => x.length >= 4 && lev1(w, x)));

export function analyzePcMessage(text: string): { pureCommand: "start" | "stop" | null; compound: boolean; stopAfter: boolean } {
  const t = text.toLowerCase();
  const words = t.split(/[^a-z\u0900-\u097f]+/).filter(Boolean);
  if (!(words.some((w) => PC_WORDS.has(w)) || /कंप्यूटर|पीसी/.test(t))) return { pureCommand: null, compound: false, stopAfter: false };
  const hasStop = words.some((w) => isWordOf(w, STOP_WORDS)) || /बंद/.test(t);
  const hasStart = words.some((w) => isWordOf(w, START_WORDS)) || /चालू|शुरू/.test(t);
  const rest = words.filter((w) => !PC_WORDS.has(w) && !FILLER.has(w) && !isWordOf(w, START_WORDS) && !isWordOf(w, STOP_WORDS));
  if ((hasStart || hasStop) && rest.length <= 1) return { pureCommand: hasStop && !hasStart ? "stop" : hasStart ? "start" : "stop", compound: false, stopAfter: false };
  if (hasStart && rest.length >= 2) return { pureCommand: null, compound: true, stopAfter: hasStop };
  return { pureCommand: null, compound: false, stopAfter: false };
}

const DOMAINS: RegExp[] = [/\b(build|code|website|web ?site|landing|app|script|api)\b/i, /\b(leads?|prospects?|scrape|research|find (me )?(companies|contacts))\b/i, /\b(e-?mail|mail|outreach|newsletter)\b/i, /\b(video|reel|animation|motion)\b/i];
export const domainCount = (t: string) => DOMAINS.filter((r) => r.test(t)).length;

export function guessVenusOptions(brief: string): { seconds: number; aspect: "16:9" | "9:16" | "1:1" } {
  const b = brief.toLowerCase();
  const aspect = /9:16|reel|shorts?|tiktok|vertical|story/.test(b) ? "9:16" : /1:1|square/.test(b) ? "1:1" : "16:9";
  let seconds = 30;
  const m = /(\d{2})\s*(?:s\b|sec|second)/.exec(b);
  if (m) seconds = Number(m[1]);
  else if (/(1|one|a)\s*minute|60\s*s/.test(b)) seconds = 60;
  return { seconds: Math.min(60, Math.max(15, seconds)), aspect };
}
