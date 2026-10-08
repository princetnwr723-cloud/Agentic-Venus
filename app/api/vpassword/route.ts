import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveDeep, vaultDelete, vaultGet, vaultPut } from "@/lib/vault";
import { connect, exec } from "@/lib/e2b-server";
import { writeFiles } from "@/lib/venus-server";
import { brandOf, hostMatches, luhn, maskUser, normSite, totp, type VpKind, type VpMeta } from "@/lib/vpassword";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, st = 500) => NextResponse.json({ error: m }, { status: st });
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const s = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
// A running task may only list and use what you allowed. You can never read a secret back through the app.
const JOB_ACTIONS = new Set(["catalog", "reveal"]);
const RDIR = "/home/user/runner";

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
    const logUse = async (m: VpMeta, chatId: string, host: string, what: string) => {
      await logs.add({ at: Date.now(), entry: m.id, label: m.label, site: host || m.site, chatId, what: what.slice(0, 200) }).catch(() => {});
      await entries.doc(m.id).set({ lastUsedAt: Date.now(), uses: FieldValue.increment(1) }, { merge: true }).catch(() => {});
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
        if (kind !== "login" && kind !== "card") return fail("Use “Capture session” for sessions.", 400);
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
        } else {
          const number = String(body.number ?? "").replace(/\D/g, "");
          if (!luhn(number)) return fail("That card number is not valid.", 400);
          const em = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/.exec(String(body.exp ?? "").trim());
          if (!em) return fail("Expiry must look like MM/YY.", 400);
          const cvc = String(body.cvc ?? "").replace(/\D/g, "");
          if (cvc.length < 3 || cvc.length > 4) return fail("The security code must be 3 or 4 digits.", 400);
          const limit = Number(body.limit);
          payload = { number, exp: em[1] + "/" + em[2].slice(-2), cvc, name: s(body.name, 80), zip: s(body.zip, 12) };
          extra = { site: normSite(s(body.site, 200)), hint: `${brandOf(number)} •••• ${number.slice(-4)}`, last4: number.slice(-4), brand: brandOf(number), ...(limit > 0 ? { limit } : {}) };
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
        if (m.kind === "card" && body.limit !== undefined) { const l = Number(body.limit); upd.limit = l > 0 ? l : FieldValue.delete(); }
        await entries.doc(m.id).set(upd, { merge: true });
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

      // ---------------- for a running task (job token): labels only, then values straight into the page ----------------
      case "catalog": {
        const chatId = auth.chatId ?? "";
        const snap = await entries.get();
        const list = snap.docs.map((d) => d.data() as VpMeta).filter((m) => allowedFor(m, chatId))
          .map((m) => ({ id: m.id, kind: m.kind, label: m.label, site: m.site, hint: m.hint, last4: m.last4, brand: m.brand, limit: m.limit, hasTotp: m.hasTotp }));
        return NextResponse.json({ entries: list });
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

        // card: only after the user approved this payment in the running task
        if (body.approved !== true) return fail("A card is only released after you approve the payment.", 403);
        if (m.site && !hostMatches(m.site, host)) return fail(`This card is restricted to ${m.site}; the page is ${host || "unknown"}.`, 403);
        const amt = parseFloat(String(body.amount ?? "").replace(/[^0-9.]/g, ""));
        if (m.limit && (!amt || amt > m.limit)) return fail(`Amount ${s(body.amount, 30) || "unknown"} is over your limit of ${m.limit} (or no amount was given).`, 403);
        await logUse(m, chatId, host, `card ${m.last4 ?? ""} used, approved, amount ${s(body.amount, 30) || "not stated"}`);
        return NextResponse.json({ number: p.number, exp: p.exp, cvc: p.cvc, name: p.name, zip: p.zip });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "vPassword request failed.");
  }
}