import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue, vaultPut } from "@/lib/vault";
import { identityLog } from "@/lib/identity-log";
import { unpack } from "@/lib/tools/catalog";
import { createInbox, domainOf, inboxPair, listMail, readMail, type MailFull } from "@/lib/tools/identity";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const host = (s: string) => s.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, body.uid);
    const uid = auth.uid;
    const chatId = auth.chatId ?? String(body.chatId || "");
    if (!chatId) return fail("chatId is missing.", 400);
    const action = String(body.action || "");
    if (auth.job && !["get", "log"].includes(action)) return fail("Background jobs cannot do that.", 403);

    const chatRef = getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId);
    const raw = ((await chatRef.get()).data() as { connectors?: Record<string, string> } | undefined)?.connectors?.identity;
    const cred = raw ? unpack(await resolveValue(uid, raw)) : [];
    const pair = inboxPair(cred);

    if (action === "get") return NextResponse.json({ enabled: Boolean(raw), address: pair?.[0] ?? null });

    if (action === "log") {
      const kind = ["used", "mail", "otp", "created"].includes(body.kind) ? body.kind : "used";
      await identityLog(uid, { chatId, kind, site: String(body.site || "unknown"), text: String(body.text || "") });
      return NextResponse.json({ ok: true });
    }

    if (action === "enable") {
      if (pair) return NextResponse.json({ address: pair[0], placeholder: raw });
      const c = await createInbox();
      const ph = await vaultPut(uid, `conn.${chatId.toLowerCase()}.identity`, `${c.address}::${c.password}::${c.base}`);
      await chatRef.update({ "connectors.identity": ph });
      await identityLog(uid, { chatId, kind: "created", site: domainOf(c.address), text: `Inbox created: ${c.address}` });
      return NextResponse.json({ address: c.address, placeholder: ph });
    }

    if (action === "overview") {
      const logSnap = await getAdminDb().collection("users").doc(uid).collection("identityLog").orderBy("at", "desc").limit(150).get();
      const log = logSnap.docs.map((d) => d.data() as { at: number; kind: string; site: string; text: string; chatId: string }).filter((x) => x.chatId === chatId).slice(0, 60);
      if (!pair) return NextResponse.json({ enabled: Boolean(raw), address: null, mails: [], services: [], log });

      const rows = await listMail(cred, 12);
      const mails: MailFull[] = [];
      for (let i = 0; i < rows.length; i += 3) {
        mails.push(...(await Promise.all(rows.slice(i, i + 3).map((r) => readMail(cred, r.id).catch(() => ({ ...r, body: "", codes: [], links: [] } as MailFull))))));
      }
      const map = new Map<string, { domain: string; mails: number; lastAt: string; lastSubject: string; codes: string[]; used: boolean }>();
      for (const m of mails) {
        const s = map.get(m.domain) ?? { domain: m.domain, mails: 0, lastAt: "", lastSubject: "", codes: [], used: false };
        s.mails++;
        if (!s.lastAt || m.at > s.lastAt) { s.lastAt = m.at; s.lastSubject = m.subject; }
        s.codes.push(...m.codes);
        map.set(m.domain, s);
      }
      for (const l of log.filter((x) => x.kind === "used")) {
        const d = host(l.site);
        const s = map.get(d) ?? { domain: d, mails: 0, lastAt: "", lastSubject: "", codes: [], used: false };
        s.used = true;
        map.set(d, s);
      }
      return NextResponse.json({
        enabled: true, address: pair[0],
        mails: mails.map((m) => ({ ...m, body: m.body.slice(0, 3000) })),
        services: Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
        log,
      });
    }
    return fail("Unknown action.", 400);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Identity request failed.");
  }
}