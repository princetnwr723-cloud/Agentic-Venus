// Browser side of FOUNT. THE RULE: it can never break the app. Every function is fail-open: on any error, timeout or
// when the feature is off, you get an empty result and the agent runs exactly as it did before.
import { auth } from "@/lib/firebase";
import { buildBlock, buildIndex, narrowToolNames, route, search, tierOf, type Example, type Index, type IntentDef, type Verdict } from "./core";

/** Master switch of the browser: set NEXT_PUBLIC_FOUNT=1 to turn FOUNT on (the server also needs FOUNT_ENABLED=1). */
export const FOUNT_ON = process.env.NEXT_PUBLIC_FOUNT === "1";
/** Optional and OFF by default: hide tools a small model does not need. Set NEXT_PUBLIC_FOUNT_NARROW=1 to try it. */
const NARROW = process.env.NEXT_PUBLIC_FOUNT_NARROW === "1";
/** Safe trial: NEXT_PUBLIC_FOUNT_SHADOW=1 works out what FOUNT would add and logs it in the console, but adds nothing to the prompt. */
const SHADOW = process.env.NEXT_PUBLIC_FOUNT_SHADOW === "1";
const MIN_CONFIDENCE = 0.45;

export type FountStatus = {
  ready: boolean;
  enabled: boolean; // server master switch is on and we are signed in
  holdout: boolean; // control group: FOUNT stays off for this user (not shown in the UI on purpose)
  optIn: boolean; // the owner allows learning from their runs
  playbooks: number; // learned + curated playbooks loaded
  lastIntent: string;
  lastBlock: boolean; // the last run really got a playbook
  lastTools: number;
  episodeByChat: Record<string, string>;
  feedbackByChat: Record<string, 1 | -1>;
};

let status: FountStatus = {
  ready: false, enabled: false, holdout: false, optIn: false, playbooks: 0,
  lastIntent: "", lastBlock: false, lastTools: 0, episodeByChat: {}, feedbackByChat: {},
};
const subs = new Set<() => void>();
export const getFountStatus = (): FountStatus => status;
export function subscribeFount(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
function setStatus(patch: Partial<FountStatus>) { status = { ...status, ...patch }; subs.forEach((f) => { try { f(); } catch { /* a listener must not break FOUNT */ } }); }

async function api<T>(action: string, extra: Record<string, unknown> = {}, ms = 2500): Promise<T | null> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch("/api/fount", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action, ...extra }),
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally { clearTimeout(timer); }
  } catch { return null; }
}

type Boot = { enabled: boolean; optIn: boolean; holdout: boolean; playbooks: Example[]; personal?: Example[] };
let index: Index | null = null;
let intents: IntentDef[] = [];
let labels: Record<string, string> = {};
let booting: Promise<void> | null = null;
let bootedAt = 0;

/** Loads the built-in examples and the learned playbooks once (and again every 10 minutes). Safe to call often. */
export function fountWarm(): Promise<void> {
  if (!FOUNT_ON || typeof window === "undefined") return Promise.resolve();
  if (booting && Date.now() - bootedAt < 10 * 60_000) return booting;
  bootedAt = Date.now();
  booting = (async () => {
    const [seed, boot] = await Promise.all([import("./seed"), api<Boot>("boot", {}, 4000)]);
    if (!boot || !boot.enabled) { setStatus({ ready: true, enabled: false }); return; }
    intents = seed.INTENTS;
    labels = seed.LABELS;
    const shared = boot.holdout ? [] : (Array.isArray(boot.playbooks) ? boot.playbooks : []);
    const own = boot.holdout ? [] : (Array.isArray(boot.personal) ? boot.personal : []);
    const learned = [...shared, ...own];
    index = buildIndex([...seed.seedExamples(), ...learned]);
    setStatus({ ready: true, enabled: true, holdout: boot.holdout === true, optIn: boot.optIn === true, playbooks: learned.length });
  })().catch(() => { setStatus({ ready: true }); });
  return booting;
}

export type FountRun = {
  /** Text to add after the owner's message (empty when FOUNT is off or nothing fits). */
  block: string;
  intent: string;
  /** Returns the tool list unchanged unless narrowing is switched on and safe. */
  narrow<T extends { name: string; source: string }>(specs: T[]): T[];
  /** `result` is the tool's output (kept only in memory, trimmed, as evidence for the verifier). */
  tool(name: string, ok: boolean, result?: string): void;
  /** Call once when the answer is shown. Never blocks the screen: do not await it. */
  end(a?: { summary: string; verify?: Verifier }): Promise<void>;
};

/** Checks a finished run against the goal (the app's own `verifyResult`, with a cheap model). */
export type Verifier = (task: string, summary: string, evidence: string[]) => Promise<{ verdict: Verdict; reason: string }>;

const NOOP: FountRun = { block: "", intent: "general.chat", narrow: (s) => s, tool() {}, end: () => Promise.resolve() };

/** Call once per owner message, right before the prompt is built. Never throws; waits at most ~0.9 s on the first message. */
export async function fountBegin(chatId: string, text: string, model: string, provider: string): Promise<FountRun> {
  try {
    if (!FOUNT_ON || typeof window === "undefined") return NOOP;
    await Promise.race([fountWarm(), new Promise<void>((r) => setTimeout(r, 900))]);
    if (!index || !status.enabled) return NOOP;

    const r = route(index, intents, text);
    const tier = tierOf(model);
    let wrapped = "";
    let ids: string[] = [];
    let wanted: string[] = [];
    if (!status.holdout && r.intent !== "general.chat" && r.confidence >= MIN_CONFIDENCE) {
      const hits = search(index, text, { intent: r.intent, k: 4 }).filter((h) => h.ex.intent === r.intent);
      const block = buildBlock({ label: labels[r.intent] ?? r.intent, hits, tier });
      if (block && SHADOW) {
        console.info(`[FOUNT shadow] ${r.intent} (${r.confidence}) would add ${block.length} characters:` + block);
      } else if (block) {
        wrapped = `\n\n---\n[App note added by AgenticVenus, not written by the owner]${block}\n---`;
        ids = hits.slice(0, 3).map((h) => h.ex.id);
        wanted = hits[0].ex.tools;
      }
    }

    const tools: string[] = [];
    const errors: string[] = [];
    const evidence: string[] = [];
    let lastFail = false;
    let ended = false;
    return {
      block: wrapped,
      intent: r.intent,
      narrow<T extends { name: string; source: string }>(specs: T[]): T[] {
        try {
          if (!NARROW || !wrapped || !wanted.length) return specs;
          const keep = narrowToolNames(specs, wanted, tier);
          return keep ? specs.filter((s) => keep.has(s.name)) : specs;
        } catch { return specs; }
      },
      tool(name: string, ok: boolean, result?: string) {
        tools.push(String(name));
        if (!ok) errors.push(String(name));
        lastFail = !ok;
        if (result) { evidence.push(`### ${name}\n${String(result).slice(0, 700)}`); if (evidence.length > 12) evidence.shift(); }
      },
      async end(a) {
        if (ended) return;
        ended = true;
        try {
          setStatus({ lastIntent: r.intent, lastBlock: wrapped.length > 0, lastTools: tools.length });
          // data minimisation: only runs that really used tools, and only when the owner opted in
          if (!status.optIn || tools.length === 0) return;
          // the app's own verifier judges the run, so learning does not have to wait for a thumbs-up.
          // It runs for FOUNT users AND the control group, so the comparison stays fair.
          let verifier: Verdict | undefined;
          if (a?.verify) {
            try {
              const v = await Promise.race([
                a.verify(text, String(a.summary || "").slice(0, 3000), [evidence.join("\n\n")]),
                new Promise<null>((res) => setTimeout(() => res(null), 30_000)),
              ]);
              if (v && (v.verdict === "pass" || v.verdict === "partial" || v.verdict === "fail")) verifier = v.verdict;
            } catch { /* no verdict: the run stays unverified */ }
          }
          const d = await api<{ episodeId?: string }>("capture", {
            chatId, task: text, intent: r.intent, confidence: r.confidence, injected: ids,
            tools, toolErrors: [...new Set(errors)], steps: tools.length, model, provider, lastToolFailed: lastFail,
            ...(verifier ? { verifier } : {}),
          }, 4000);
          if (d?.episodeId) setStatus({ episodeByChat: { ...status.episodeByChat, [chatId]: d.episodeId } });
        } catch { /* learning is best effort */ }
      },
    };
  } catch { return NOOP; }
}

/** 👍 / 👎 on the last run of a chat. Returns true when it was saved. */
export async function fountFeedback(chatId: string, thumbs: 1 | -1): Promise<boolean> {
  const episodeId = status.episodeByChat[chatId];
  if (!episodeId) return false;
  const d = await api<{ ok?: boolean }>("feedback", { episodeId, thumbs });
  if (d?.ok) setStatus({ feedbackByChat: { ...status.feedbackByChat, [chatId]: thumbs } });
  return d?.ok === true;
}

export async function fountSetConsent(optIn: boolean): Promise<boolean> {
  const d = await api<{ optIn?: boolean }>("consent", { optIn });
  if (d && typeof d.optIn === "boolean") { setStatus({ optIn: d.optIn }); return d.optIn; }
  return status.optIn;
}

/** "Delete my FOUNT data": removes this owner's stored runs and turns learning off. */
export async function fountForget(): Promise<number | null> {
  const d = await api<{ deleted?: number }>("forget", {}, 8000);
  if (!d) return null;
  setStatus({ optIn: false, episodeByChat: {}, feedbackByChat: {} });
  return d.deleted ?? 0;
}
