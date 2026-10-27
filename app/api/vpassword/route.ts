import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveDeep, vaultDelete, vaultGet, vaultPut } from "@/lib/vault";
import { connect, exec } from "@/lib/e2b-server";
import { writeFiles } from "@/lib/venus-server";
import {
  applySpend, brandOf, checkSpend, cleanProxy, hostMatches, luhn, maskUser, maxAmount, normSite, pageTotalChanged,
  parseAmount, spendLeft, totalLooksWrong, totp, type VpKind, type VpMeta,
} from "@/lib/vpassword";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, st = 500) => NextResponse.json({ error: m }, { status: st });
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const s = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
// A running task may only list and use what you allowed. You can never read a secret back through the app.
// payment_request / payment_status let the task ASK for a payment and wait; only YOU (signed in) can approve it.
const JOB_ACTIONS = new Set(["catalog", "reveal", "payment_request", "payment_status"]);
const RDIR = "/home/user/runner";
const PENDING_MS = 30 * 60_000; // how long a payment request waits for your answer
const APPROVED_MS = 10 * 60_000; // how long an approval can still be used

class Deny extends Error {
  status: number;
  constructor(message: string, status = 403) { super(message); this.status = status; }
}

type PayDoc = {
  id: string; entry: string; label: string; last4: string; chatId: string; host: string;
  amount: number; detected: number | null; mismatch: boolean; note: string; tainted: boolean;
  status: "pending" | "approved" | "denied" | "expired" | "used";
  createdAt: number; expiresAt: number; approvedAt?: number; approvedUntil?: number; usedAt?: number;
};

const CAPTURE = `import {chromium} from "playwright-core";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", {timeout: 8000});
const ctx = b.contexts()[0];
const cookies = ctx ? await ctx.cookies() : [];
console.log("@@COOKIES" + JSON.stringify(cookies));
process.exit(0);
`;

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, raw?.uid);
    const uid = auth.uid;
    const body = (await resolveDeep(uid, raw)) as Record<string, any>;
    const action = String(body.action || "");
    if (auth.job !== JOB_ACTIONS.has(action)) {
      return fail(auth.job ? "A running task can only list and use what you allowed." : "Secrets can never be read back from the app: only a running task can use them.", 403);
    }

    const db = getAdminDb();
    const entries = db.collection("users").doc(uid).collection("vpass");
    const logs = db.collection("users").doc(uid).collection("vplog");
    const pays = db.collection("users").doc(uid).collection("vpay");
    const getMeta = async (id: string): Promise<VpMeta | null> => {
      if (!ID.test(id)) return null;
      const d = await entries.doc(id).get();
      return d.exists ? (d.data() as VpMeta) : null;
    };
    const secretOf = async (id: string): Promise<Record<string, any> | null> => {
      const t = await vaultGet(uid, "vp." + id);
      try { return t ? JSON.parse(t) : null; } catch { return null; }
    };
    const allowedFor = (m: VpMeta, chatId: string) => m.allowed === "all" || (Array.isArray(m.allowed) && m.allowed.includes(chatId));
    const cleanAllowed = (v: unknown): string[] | "all" => (v === "all" ? "all" : Array.isArray(v) ? v.map(String).filter((x) => ID.test(x)).slice(0, 60) : []);
    const logLine = async (m: Pick<VpMeta, "id" | "label" | "site">, chatId: string, host: string, what: string) => {
      await logs.add({ at: Date.now(), entry: m.id, label: m.label, site: host || m.site, chatId, what: what.slice(0, 200) }).catch(() => {});
    };
    const logUse = async (m: VpMeta, chatId: string, host: string, what: string) => {
      await logLine(m, chatId, host, what);
      await entries.doc(m.id).set({ lastUsedAt: Date.now(), uses: FieldValue.increment(1) }, { merge: true }).catch(() => {});
    };
    // A card may only be used on a site you chose (or on "any site" if you chose that on purpose).
    const cardSiteProblem = (m: VpMeta, host: string): string => {
      if (!m.site && !m.anySite) return "This card has no site restriction yet. Open vPassword, open the card and choose its site (or “any site”).";
      if (m.site && !hostMatches(m.site, host)) return `This card is restricted to ${m.site}; the page is ${host || "unknown"}.`;
      return "";
    };
    const expireIf = async (id: string, from: PayDoc["status"]) => {
      await db.runTransaction(async (tx) => {
        const ref = pays.doc(id);
        const snap = await tx.get(ref);
        if (snap.exists && (snap.data() as PayDoc).status === from) tx.update(ref, { status: "expired" });
      }).catch(() => {});
    };

    switch (action) {
      // ---------------- for you (the signed-in user) ----------------
      case "list": {
        const snap = await entries.get();
        const list = snap.docs.map((d) => d.data() as VpMeta).sort((a, b) => b.createdAt - a.createdAt);
        return NextResponse.json({ entries: list });
      }

      case "add": {
        const kind = body.kind as VpKind;
        if (kind !== "login" && kind !== "card" && kind !== "proxy") return fail("Use “Capture session” for sessions.", 400);
        const label = s(body.label, 60);
        if (!label) return fail("Give it a name.", 400);
        const id = ID.test(String(body.id || "")) ? String(body.id) : "vp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const old = await getMeta(id);
        let payload: Record<string, unknown>;
        let extra: Partial<VpMeta>;

        if (kind === "login") {
          const site = normSite(s(body.site, 200));
          const username = s(body.username, 200);
          const password = String(body.password ?? "").slice(0, 300);
          const seed = String(body.totp ?? "").replace(/\s+/g, "");
          if (!site || !username || !password) return fail("A login needs a site, a username/email and a password.", 400);
          if (seed) { try { totp(seed); } catch { return fail("The 2FA secret must be the base32 setup key (letters A–Z and digits 2–7).", 400); } }
          payload = { username, password, ...(seed ? { totp: seed } : {}) };
          extra = { site, hint: maskUser(username), hasTotp: Boolean(seed) };
        } else if (kind === "proxy") {
          const c = cleanProxy(body);
          if (!c.ok) return fail(c.error, 400);
          payload = { ...c.cfg };
          extra = { site: "", hint: `${c.cfg.scheme}://${c.cfg.host}:${c.cfg.port}` };
        } else {
          const number = String(body.number ?? "").replace(/\D/g, "");
          if (!luhn(number)) return fail("That card number is not valid.", 400);
          const em = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/.exec(String(body.exp ?? "").trim());
          if (!em) return fail("Expiry must look like MM/YY.", 400);
          const cvc = String(body.cvc ?? "").replace(/\D/g, "");
          if (cvc.length < 3 || cvc.length > 4) return fail("The security code must be 3 or 4 digits.", 400);
          const site = normSite(s(body.site, 200));
          if (!site && body.anySite !== true) return fail("Enter the site this card may be used on, or tick “any site”.", 400);
          const limit = parseAmount(body.limit), budget = parseAmount(body.budget), daily = parseAmount(body.daily);
          payload = { number, exp: em[1] + "/" + em[2].slice(-2), cvc, name: s(body.name, 80), zip: s(body.zip, 12) };
          extra = {
            site, anySite: !site, hint: `${brandOf(number)} •••• ${number.slice(-4)}`, last4: number.slice(-4), brand: brandOf(number),
            ...(limit > 0 ? { limit } : {}), ...(budget > 0 ? { budget } : {}), ...(daily > 0 ? { daily } : {}),
            spent: old?.spent ?? 0, ...(old?.dayKey ? { dayKey: old.dayKey } : {}), daySpent: old?.daySpent ?? 0,
          };
        }

        await vaultPut(uid, "vp." + id, JSON.stringify(payload));
        const meta: VpMeta = { id, kind, label, site: "", hint: "", allowed: cleanAllowed(body.allowed), createdAt: old?.createdAt ?? Date.now(), uses: old?.uses ?? 0, ...extra };
        await entries.doc(id).set(JSON.parse(JSON.stringify(meta)));
        await logs.add({ at: Date.now(), entry: id, label, site: meta.site, chatId: "", what: old ? "updated" : "saved" }).catch(() => {});
        return NextResponse.json({ id });
      }

      case "update": {
        const m = await getMeta(String(body.id || ""));
        if (!m) return fail("Entry not found.", 404);
        const upd: Record<string, unknown> = {};
        if (body.label !== undefined) upd.label = s(body.label, 60) || m.label;
        if (body.allowed !== undefined) upd.allowed = cleanAllowed(body.allowed);
        if (m.kind === "card") {
          for (const k of ["limit", "budget", "daily"] as const) {
            if (body[k] !== undefined) { const v = parseAmount(body[k]); upd[k] = v > 0 ? v : FieldValue.delete(); }
          }
          if (body.site !== undefined || body.anySite !== undefined) {
            const st = body.site !== undefined ? normSite(s(body.site, 200)) : m.site;
            if (!st && body.anySite !== true) return fail("A card needs a site, or choose “any site”.", 400);
            upd.site = st;
            upd.anySite = !st;
          }
          if (body.resetSpent === true) { upd.spent = 0; upd.daySpent = 0; upd.dayKey = FieldValue.delete(); }
        }
        await entries.doc(m.id).set(upd, { merge: true });
        if (body.resetSpent === true) await logLine(m, "", "", "spent counter reset");
        return NextResponse.json({ ok: true });
      }

      case "delete": {
        const m = await getMeta(String(body.id || ""));
        if (!m) return fail("Entry not found.", 404);
        await vaultDelete(uid, "vp." + m.id);
        await entries.doc(m.id).delete();
        await logs.add({ at: Date.now(), entry: m.id, label: m.label, site: m.site, chatId: "", what: "deleted" }).catch(() => {});
        return NextResponse.json({ ok: true });
      }

      case "activity": {
        const snap = await logs.orderBy("at", "desc").limit(60).get();
        return NextResponse.json({ log: snap.docs.map((d) => d.data()) });
      }

      // A one-time code so you can check that the 2FA secret you saved is right. The secret itself never leaves the server.
      case "totp_preview": {
        const m = await getMeta(String(body.id || ""));
        const p = m ? await secretOf(m.id) : null;
        if (!m || !p?.totp) return fail("This entry has no 2FA secret.", 400);
        return NextResponse.json({ code: totp(String(p.totp)), expiresIn: 30 - (Math.floor(Date.now() / 1000) % 30) });
      }

      // Saves the cookies of a site you logged into ONCE on the computer's screen, so later computers need no login or OTP.
      case "capture_session": {
        const site = normSite(s(body.site, 200));
        if (!site) return fail("Enter the site (for example github.com).", 400);
        if (!body.e2bKey || !body.sandboxId) return fail("Pick a chat that has a computer.", 400);
        const sb = await connect(String(body.e2bKey), String(body.sandboxId));
        const have = await exec(sb, `test -d ${RDIR}/node_modules/playwright-core && echo yes || echo no`, 10_000);
        if (!have.stdout.includes("yes")) return fail("Run any computer task in that chat once first, so the browser tools get installed. Then log in on the computer's screen (Take control) and try again.", 400);
        await writeFiles(sb, { [`${RDIR}/capture.mjs`]: CAPTURE });
        const r = await exec(sb, `cd ${RDIR} && timeout 25 node capture.mjs 2>&1 | tail -c 450000`, 32_000);
        const at = r.stdout.indexOf("@@COOKIES");
        if (at < 0) return fail("Could not read the browser on that computer. Open the computer panel, make sure the browser window is open, and try again. " + r.stdout.slice(0, 160), 400);
        let all: any[] = [];
        try { all = JSON.parse(r.stdout.slice(at + 9)); } catch { return fail("The browser answered something unreadable.", 500); }
        const cookies = all.filter((c) => {
          const d = String(c?.domain ?? "").replace(/^\./, "").toLowerCase();
          return d && (hostMatches(site, d) || hostMatches(d, site));
        }).slice(0, 150);
        if (!cookies.length) return fail(`No cookies for ${site} were found. Log in to ${site} on the computer's screen first (Take control), then capture again.`, 400);
        const json = JSON.stringify({ cookies });
        if (json.length > 380_000) return fail("That session is too large to store.", 400);
        const id = "vp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await vaultPut(uid, "vp." + id, json);
        const meta: VpMeta = { id, kind: "session", label: s(body.label, 60) || site, site, hint: `${cookies.length} cookies`, cookies: cookies.length, allowed: cleanAllowed(body.allowed), createdAt: Date.now(), uses: 0 };
        await entries.doc(id).set(JSON.parse(JSON.stringify(meta)));
        await logs.add({ at: Date.now(), entry: id, label: meta.label, site, chatId: "", what: `session captured (${cookies.length} cookies)` }).catch(() => {});
        return NextResponse.json({ id, count: cookies.length, site });
      }

      // Payments an agent is waiting to make. Only you (signed in) can approve or decline them.
      case "pending_payments": {
        const now = Date.now();
        const snap = await pays.where("status", "==", "pending").get();
        const metas = new Map<string, VpMeta | null>();
        const out: Record<string, unknown>[] = [];
        for (const d of snap.docs) {
          const p = d.data() as PayDoc;
          if (p.expiresAt <= now) continue;
          if (!metas.has(p.entry)) metas.set(p.entry, await getMeta(p.entry));
          const m = metas.get(p.entry);
          const left = m ? spendLeft(m, now) : { budgetLeft: null, dailyLeft: null };
          out.push({
            id: p.id, label: p.label, last4: p.last4, host: p.host, amount: p.amount, detected: p.detected, mismatch: p.mismatch,
            note: p.note, tainted: p.tainted, createdAt: p.createdAt, expiresAt: p.expiresAt, limit: m?.limit ?? null, ...left,
          });
        }
        out.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
        return NextResponse.json({ payments: out.slice(0, 10) });
      }

      case "approve_payment": {
        const id = s(body.id, 60);
        if (!ID.test(id)) return fail("Unknown payment.", 400);
        try {
          const p = await db.runTransaction(async (tx) => {
            const pref = pays.doc(id);
            const ps = await tx.get(pref);
            if (!ps.exists) throw new Deny("That payment request does not exist any more.", 404);
            const pd = ps.data() as PayDoc;
            const es = await tx.get(entries.doc(pd.entry));
            if (pd.status !== "pending") throw new Deny("That payment was already answered (" + pd.status + ").", 409);
            if (Date.now() > pd.expiresAt) throw new Deny("That payment request expired. Ask the agent to try again.", 409);
            if (!es.exists) throw new Deny("That card was deleted.", 404);
            const chk = checkSpend(es.data() as VpMeta, pd.amount);
            if (!chk.ok) throw new Deny(chk.error + " Raise the limit in vPassword if you really want this.");
            tx.update(pref, { status: "approved", approvedAt: Date.now(), approvedUntil: Date.now() + APPROVED_MS });
            return pd;
          });
          await logLine({ id: p.entry, label: p.label, site: p.host }, p.chatId, p.host, `payment of ${p.amount} APPROVED by you`);
          return NextResponse.json({ ok: true });
        } catch (e) {
          if (e instanceof Deny) return fail(e.message, e.status);
          throw e;
        }
      }

      case "deny_payment": {
        const id = s(body.id, 60);
        if (!ID.test(id)) return fail("Unknown payment.", 400);
        const snap = await pays.doc(id).get();
        if (!snap.exists) return fail("That payment request does not exist any more.", 404);
        const p = snap.data() as PayDoc;
        if (p.status === "pending" || p.status === "approved") {
          await pays.doc(id).update({ status: "denied" });
          await logLine({ id: p.entry, label: p.label, site: p.host }, p.chatId, p.host, `payment of ${p.amount} DECLINED by you`);
        }
        return NextResponse.json({ ok: true });
      }

      // ---------------- for a running task (job token): labels only, then values straight into the page ----------------
      case "catalog": {
        const chatId = auth.chatId ?? "";
        const snap = await entries.get();
        const list = snap.docs.map((d) => d.data() as VpMeta).filter((m) => allowedFor(m, chatId))
          .map((m) => ({
            id: m.id, kind: m.kind, label: m.label, site: m.site, hint: m.hint, last4: m.last4, brand: m.brand, limit: m.limit, hasTotp: m.hasTotp,
            ...(m.kind === "card" ? spendLeft(m) : {}),
          }));
        return NextResponse.json({ entries: list });
      }

      // The agent asks to pay. Nothing is released yet: you get an approval banner in the app.
      case "payment_request": {
        const chatId = auth.chatId ?? "";
        const m = await getMeta(String(body.id || ""));
        if (!m || m.kind !== "card") return fail("That card does not exist.", 404);
        if (!allowedFor(m, chatId)) return fail("You have not allowed this agent to use that card (open vPassword and tick this chat).", 403);
        const host = s(body.host, 200).toLowerCase().replace(/^www\./, "");
        if (!host) return fail("The page address is unknown, so the payment cannot be checked.", 400);
        const problem = cardSiteProblem(m, host);
        if (problem) return fail(problem, 403);
        const amount = parseAmount(body.amount);
        const chk = checkSpend(m, amount);
        if (!chk.ok) return fail(chk.error + " Nothing was asked of the user.", 403);
        const detected = maxAmount(body.detected);
        const now = Date.now();
        const open = await pays.where("status", "==", "pending").get();
        if (open.docs.filter((d) => { const x = d.data() as PayDoc; return x.chatId === chatId && x.expiresAt > now; }).length >= 3) {
          return fail("Too many payment requests are already waiting for the user's answer. Wait for them first.", 429);
        }
        const payId = "pay" + now.toString(36) + Math.random().toString(36).slice(2, 6);
        const doc: PayDoc = {
          id: payId, entry: m.id, label: m.label, last4: m.last4 ?? "", chatId, host, amount, detected,
          mismatch: totalLooksWrong(amount, detected), note: s(body.note, 140), tainted: body.tainted === true,
          status: "pending", createdAt: now, expiresAt: now + PENDING_MS,
        };
        await pays.doc(payId).set(JSON.parse(JSON.stringify(doc)));
        await logLine(m, chatId, host, `payment of ${amount} requested, waiting for you`);
        return NextResponse.json({ payId, expiresInSec: Math.round(PENDING_MS / 1000) });
      }

      case "payment_status": {
        const payId = s(body.payId, 60);
        if (!ID.test(payId)) return fail("Unknown payment.", 400);
        const snap = await pays.doc(payId).get();
        if (!snap.exists) return fail("That payment request does not exist.", 404);
        const p = snap.data() as PayDoc;
        if (p.chatId !== (auth.chatId ?? "")) return fail("That payment request belongs to another agent.", 403);
        let status = p.status;
        const now = Date.now();
        if (status === "pending" && now > p.expiresAt) { status = "expired"; await expireIf(payId, "pending"); }
        else if (status === "approved" && now > (p.approvedUntil ?? 0)) { status = "expired"; await expireIf(payId, "approved"); }
        return NextResponse.json({ status });
      }

      case "reveal": {
        const chatId = auth.chatId ?? "";
        const m = await getMeta(String(body.id || ""));
        if (!m) return fail("That vPassword entry does not exist.", 404);
        if (!allowedFor(m, chatId)) return fail("You have not allowed this agent to use that entry (open vPassword and tick this chat).", 403);
        const host = s(body.host, 200).toLowerCase().replace(/^www\./, "");
        const purpose = String(body.purpose || "");
        const p = await secretOf(m.id);
        if (!p) return fail("The saved secret could not be opened. Please enter it again in vPassword.", 500);

        // proxy: the system (not the model) uses it to start the browser
        if (m.kind === "proxy") {
          if (purpose !== "proxy") return fail("A proxy can only be used by the system when the browser starts.", 403);
          await logUse(m, chatId, "", "proxy started for the browser");
          return NextResponse.json({ scheme: p.scheme, host: p.host, port: p.port, username: p.username, password: p.password, tz: p.tz, lang: p.lang });
        }

        if (m.kind === "login" || m.kind === "session") {
          if (!hostMatches(m.site, host)) return fail(`This page (${host || "unknown"}) is not ${m.site}. Nothing was released.`, 403);
          if (m.kind === "session") {
            await logUse(m, chatId, host, "session restored");
            return NextResponse.json({ cookies: p.cookies ?? [] });
          }
          if (purpose === "totp") {
            if (!p.totp) return fail("This login has no 2FA secret.", 400);
            await logUse(m, chatId, host, "2FA code generated");
            return NextResponse.json({ totp: totp(String(p.totp)) });
          }
          await logUse(m, chatId, host, "login filled");
          return NextResponse.json({ username: p.username, password: p.password, hasTotp: Boolean(p.totp) });
        }

        // card: ONLY with a payment you approved in the app. The amount comes from your approval, never from the agent.
        const problem = cardSiteProblem(m, host);
        if (problem) return fail(problem, 403);
        const payId = s(body.payId, 60);
        if (!ID.test(payId)) return fail("A card is only released for a payment you approved in the app.", 403);
        const nowSeen = maxAmount(body.detected);
        try {
          const amount = await db.runTransaction(async (tx) => {
            const pref = pays.doc(payId);
            const eref = entries.doc(m.id);
            const ps = await tx.get(pref);
            const es = await tx.get(eref);
            if (!ps.exists) throw new Deny("That payment approval does not exist.");
            if (!es.exists) throw new Deny("That card was deleted.");
            const pd = ps.data() as PayDoc;
            const cur = es.data() as VpMeta;
            if (pd.entry !== m.id || pd.chatId !== chatId) throw new Deny("That approval is for another card or another agent.");
            if (pd.status === "used") throw new Deny("That approval was already used. Ask for a new payment approval.");
            if (pd.status !== "approved") throw new Deny("This payment is not approved (status: " + pd.status + ").");
            if (Date.now() > (pd.approvedUntil ?? 0)) throw new Deny("The approval expired. Ask for a new one.");
            if (!hostMatches(pd.host, host)) throw new Deny(`You approved this payment on ${pd.host}, but the page is ${host || "unknown"}.`);
            if (pageTotalChanged(pd.amount, pd.detected, nowSeen)) throw new Deny(`The total on the page (${nowSeen}) is higher than what you approved (${pd.amount}). Nothing was released. Check the cart and ask again.`);
            const chk = checkSpend(cur, pd.amount);
            if (!chk.ok) throw new Deny(chk.error);
            tx.update(pref, { status: "used", usedAt: Date.now() });
            tx.set(eref, { ...applySpend(cur, pd.amount), lastUsedAt: Date.now(), uses: FieldValue.increment(1) }, { merge: true });
            return pd.amount;
          });
          await logLine(m, chatId, host, `card ${m.last4 ?? ""} released for the approved payment of ${amount}`);
          return NextResponse.json({ number: p.number, exp: p.exp, cvc: p.cvc, name: p.name, zip: p.zip, amount });
        } catch (e) {
          if (e instanceof Deny) return fail(e.message, e.status);
          throw e;
        }
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "vPassword request failed.");
  }
}
