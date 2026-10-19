import { deleteField, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { contractPrompt, extractContract, NO_CONTRACT, type Contract } from "@/lib/contract";
import type { Recipe, RecipeStep } from "@/lib/recipes";
import type { ProviderId } from "@/lib/providers";

export type PcEnv = { uid: string; token: () => Promise<string>; e2bKey: string };
export type HealCtx = { recipe: Recipe; keep: RecipeStep[]; session: unknown; snapshot: string; url: string };
export type PcOutcome = { status: string; summary: string; recipe: RecipeStep[] | null; proof: string | null };
export type PcPending = { id: string; kind: string; site?: string; question?: string; options?: string[]; message?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** jobKey = the chat id for the chat's own computer; team members use "<chatId>_w_<memberId>" so parallel jobs never overwrite each other. */
export const pcJobRef = (uid: string, jobKey: string) => doc(db, "users", uid, "pcJobs", jobKey);

async function post(env: PcEnv, url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ uid: env.uid, e2bKey: env.e2bKey, ...body }),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}: ${text.slice(0, 160) || "(empty)"}` }; }
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

/** The background agent needs Node + git etc. on the computer: same one-time setup Venus Code uses. */
export async function ensureNode(env: PcEnv, sandboxId: string, onLine: (l: string) => void) {
  const s = await post(env, "/api/code/ws", { action: "status", sandboxId });
  if (s.state === "ready") return;
  if (s.state !== "installing") {
    onLine("⚙️ First time on this computer: installing tools (a few minutes, once)…");
    await post(env, "/api/code/ws", { action: "setup", sandboxId });
  }
  for (let i = 0; i < 160; i++) {
    await sleep(5000);
    const t = await post(env, "/api/code/ws", { action: "status", sandboxId });
    if (t.state === "ready") return;
    if (t.state === "failed") throw new Error("Computer setup failed:\n" + String(t.log).slice(-400));
  }
  throw new Error("Computer setup timed out.");
}

/** "100 leads" becomes a contract the runner enforces: only independently verified items count. */
async function contractFor(env: PcEnv, a: { provider: ProviderId; model: string; apiKey: string; task: string }): Promise<Contract> {
  const llm = async (system: string, prompt: string) => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
      body: JSON.stringify({ provider: a.provider, apiKey: a.apiKey, model: a.model, systemPrompt: system, messages: [{ role: "user", content: prompt }] }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || "contract step failed");
    return String(d.reply ?? "");
  };
  return extractContract(llm, a.task);
}

export async function startPcJob(env: PcEnv, a: {
  sandboxId: string; chatId: string; jobKey?: string; task: string; provider: ProviderId; model: string; apiKey: string; context?: string; heal?: HealCtx;
}): Promise<string> {
  const contract = a.heal ? NO_CONTRACT : await contractFor(env, a).catch(() => NO_CONTRACT);
  const instruction = a.heal ? a.task : a.task + contractPrompt(contract);
  const r = await post(env, "/api/runner", {
    action: "pcstart", sandboxId: a.sandboxId, chatId: a.chatId, task: instruction, provider: a.provider, model: a.model, apiKey: a.apiKey,
    context: a.context, appUrl: window.location.origin, proof: true,
    contract: contract.kind === "list" ? contract : undefined,
    maxSteps: contract.kind === "list" ? Math.min(200, 70 + contract.quota) : undefined,
    ...(a.heal ? { session: a.heal.session, healSnapshot: a.heal.snapshot, startUrl: a.heal.url } : {}),
  });
  const jobId = String(r.jobId);
  await setDoc(pcJobRef(env.uid, a.jobKey ?? a.chatId), { running: true, task: a.task.slice(0, 300), startedAt: Date.now(), job: { id: jobId, sandboxId: a.sandboxId, offset: 0, hb: Date.now() } });
  return jobId;
}

// ---------------- fact check: the code (not the model) checks cited claims against their source pages ----------------

const SKIP_LINE = /(replay|download|watch the|\.csv\b|switched off|computer was|link works for)/i;

/**
 * Every result line that cites a URL is checked by verify.facts (the server fetches the page and looks for the key
 * numbers and names). Lines that fail get an UNVERIFIED mark, lines whose page could not be read get UNCHECKED,
 * and a FACT CHECK footer says how many held up. Lead lists already carry a code-built "VERIFIED:" line: skipped.
 */
async function factCheck(env: PcEnv, chatId: string, summary: string): Promise<string> {
  if (/^VERIFIED:/m.test(summary) || summary.length < 120) return summary;
  const lines = summary.split("\n");
  const claims: Array<{ line: number; claim: string; source_url: string }> = [];
  lines.forEach((l, i) => {
    if (SKIP_LINE.test(l)) return;
    const m = /https?:\/\/[^\s)\]>"']+/.exec(l);
    if (!m) return;
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const claim = l
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[*_`>#|•]+/g, " ")
      .replace(/^\s*[-\d.)]+\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (claim.length < 25 || !/\d|[A-Z][a-z]{2,}/.test(claim)) return;
    if (claims.length < 10) claims.push({ line: i, claim: claim.slice(0, 380), source_url: url });
  });

  if (!claims.length) {
    const numbers = (summary.match(/\d[\d,.]*/g) ?? []).length;
    return numbers >= 3 && !/https?:\/\//.test(summary)
      ? summary + "\n\n⚠️ NOT FACT-CHECKED: this result cites no source links, so its figures could not be verified. Treat them as unverified."
      : summary;
  }

  try {
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
      body: JSON.stringify({ action: "call", uid: env.uid, chatId, name: "verify.facts", args: { claims: claims.map((c) => ({ claim: c.claim, source_url: c.source_url })) }, approved: false, force: false }),
      signal: AbortSignal.timeout(58_000),
    });
    const d = await res.json().catch(() => ({}));
    const items: Array<{ i: number; verdict: string; reason?: string }> = JSON.parse(String(d.text ?? "{}")).items ?? [];
    if (!items.length) return summary + "\n\nℹ️ Fact check could not run this time.";
    let ok = 0, bad = 0, unread = 0;
    const out = [...lines];
    for (const it of items) {
      const c = claims[it.i];
      if (!c) continue;
      if (it.verdict === "verified") { ok++; continue; }
      if (/could not be read/i.test(String(it.reason))) { unread++; out[c.line] = `⚠️ UNCHECKED (source page could not be read): ${lines[c.line]}`; }
      else if (it.verdict === "rejected") { bad++; out[c.line] = `⚠️ UNVERIFIED (${String(it.reason).slice(0, 90)}): ${lines[c.line]}`; }
      else { unread++; out[c.line] = `⚠️ UNCHECKED (ran out of time): ${lines[c.line]}`; }
    }
    return `${out.join("\n")}\n\n🔎 FACT CHECK (done by code, not by the model): ${ok} of ${claims.length} cited claims confirmed on their source page${bad ? `, ${bad} NOT found on the source (marked UNVERIFIED)` : ""}${unread ? `, ${unread} source(s) could not be read (marked UNCHECKED)` : ""}.`;
  } catch {
    return summary + "\n\nℹ️ Fact check could not run this time.";
  }
}

/** Follows a running job while this tab is open. If the tab closes, the job keeps going and /api/runner/tick finishes it. */
export async function followPcJob(a: {
  env: PcEnv; chatId: string; jobKey?: string; sandboxId: string; jobId: string;
  onStep: (line: string) => void; onAsk: (p: PcPending) => Promise<Record<string, unknown>>; cancelled: () => boolean;
}): Promise<PcOutcome> {
  const { env, sandboxId, jobId } = a;
  const key = a.jobKey ?? a.chatId;
  let offset = 0, fails = 0, lastAsk = "", stopSent = false;
  const beat = () => void setDoc(pcJobRef(env.uid, key), { running: true, job: { id: jobId, sandboxId, offset, hb: Date.now() } }, { merge: true }).catch(() => {});
  const hb = setInterval(beat, 8000);
  const pump = (events: Array<{ k: string; text: string }>) => { for (const e of events) if (e.k === "step" || e.k === "info" || e.k === "error") a.onStep(e.text); };

  try {
    for (;;) {
      await sleep(2500);
      if (a.cancelled() && !stopSent) { stopSent = true; await post(env, "/api/runner", { action: "stop", sandboxId, jobId }).catch(() => {}); }
      let st: any;
      try { st = await post(env, "/api/runner", { action: "status", sandboxId, jobId, offset }); fails = 0; }
      catch (e) { if (++fails >= 25) throw e; continue; }
      pump(st.events ?? []);
      offset = st.next ?? offset;

      const p = st.state?.pending as PcPending | undefined;
      if (p && p.id !== lastAsk) {
        lastAsk = p.id;
        const reply = await a.onAsk(p);
        await post(env, "/api/runner", { action: "answer", sandboxId, jobId, qid: p.id, reply }).catch(() => {});
        continue;
      }
      const s = st.state;
      if (s?.status && s.status !== "running") {
        for (let i = 0; i < 4; i++) {
          const m = await post(env, "/api/runner", { action: "status", sandboxId, jobId, offset });
          pump(m.events ?? []);
          offset = m.next ?? offset;
          if ((m.events ?? []).length < 300) break;
        }
        await setDoc(pcJobRef(env.uid, key), { running: false, job: deleteField() }, { merge: true }).catch(() => {});
        let summary = String(s.summary || "");
        if (String(s.status) === "done" && summary) {
          a.onStep("🔎 Checking the cited claims against their sources…");
          summary = await factCheck(env, a.chatId, summary);
        }
        return { status: String(s.status), summary, recipe: (s.recipe as RecipeStep[] | null) ?? null, proof: (s.proof as string | null) ?? null };
      }
    }
  } finally {
    clearInterval(hb);
  }
}

export async function proofUrl(env: PcEnv, path: string): Promise<string> {
  const d = await post(env, "/api/venus/media", { action: "url", path });
  return String(d.url ?? "");
}