import { NextResponse } from "next/server";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { dangerousFlags, saveSkillServer, setRoleServer } from "@/lib/learning";
import { looksSecret } from "@/lib/learn-utils";
import { BUILTIN_BY_ID } from "@/lib/marketplace-data";
import { fillTemplate, missingFields, textOf, validatePublish, type Listing } from "@/lib/marketplace-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const COL = "marketplace";
const CHAT_ID = /^[A-Za-z0-9_-]{4,160}$/;
const LISTING_ID = /^c_[a-z0-9]{6,30}$/;
const MAX_LISTINGS_PER_USER = 20;
const HIDE_AFTER_REPORTS = 3;

type Doc = Omit<Listing, "id" | "official"> & { ownerUid: string; status: "live" | "hidden"; reports: number; installs: number; createdAt: number };

/** What the public sees: never the owner's uid or the report count. */
function pub(id: string, d: Doc): Listing {
  const { ownerUid: _o, status: _s, reports: _r, ...rest } = d;
  return { id, ...rest, official: false };
}

async function find(id: string): Promise<{ l: Listing; ref?: DocumentReference } | null> {
  const built = BUILTIN_BY_ID.get(id);
  if (built) return { l: built };
  if (!LISTING_ID.test(id)) return null;
  const ref = getAdminDb().collection(COL).doc(id);
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data() as Doc;
  return d.status === "live" ? { l: pub(id, d), ref } : null;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 8)) out[k] = String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return out;
};
const unsafe = (text: string): string | null => {
  if (looksSecret(text)) return "The text looks like it contains a secret (password, key or card number). Remove it and try again.";
  if (dangerousFlags(text).length) return "The text contains instruction-like text that tries to control the agent (for example 'ignore previous instructions'). Rewrite it and try again.";
  return null;
};

/** Public: the community listings that are live. The official catalog ships inside the app, so this never fails the page. */
export async function GET() {
  try {
    const snap = await getAdminDb().collection(COL).where("status", "==", "live").limit(300).get();
    const items = snap.docs.map((d) => pub(d.id, d.data() as Doc))
      .sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
  } catch (e) {
    return NextResponse.json({ items: [], error: e instanceof Error ? e.message : "Community listings are unavailable." });
  }
}

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 96 * 1024 });
    const uid = String(b.uid);
    const action = String(b.action || "");
    const db = getAdminDb();

    if (action === "install") {
      const hit = await find(String(b.id || ""));
      if (!hit) return fail("This listing is not available any more.", 404);
      const { l, ref } = hit;
      const chatId = String(b.chatId || "");
      if (!CHAT_ID.test(chatId)) return fail("Choose a chat first.");
      const chat = await db.collection("users").doc(uid).collection("chats").doc(chatId).get();
      if (!chat.exists) return fail("That chat no longer exists.", 404);
      // Official listings are ours. Anything a user published is scanned again at install time.
      if (!l.official) { const bad = unsafe(textOf(l)); if (bad) return fail("This listing was blocked: " + bad, 422); }
      const source = "marketplace:" + l.id;
      const names: string[] = [];

      if (l.kind === "skill" && l.skill) {
        const s = await saveSkillServer(uid, chatId, { ...l.skill, source, tags: l.tags.slice(0, 6) });
        names.push(s.name);
      } else if (l.kind === "agent" && l.agent) {
        await setRoleServer(uid, chatId, l.agent.role);
        for (const k of l.agent.skills) names.push((await saveSkillServer(uid, chatId, { ...k, source, tags: l.tags.slice(0, 6) })).name);
      } else if (l.kind === "automation" && l.routine) {
        const values = strMap(b.fields);
        const miss = missingFields(l.fields ?? [], values);
        if (miss.length) return fail("Please fill in: " + miss.join(", ") + ".");
        ref?.update({ installs: FieldValue.increment(1) }).catch(() => undefined);
        return NextResponse.json({
          ok: true, kind: l.kind, needs: l.needs ?? [],
          routine: { ...l.routine, name: l.name.slice(0, 80), instructions: fillTemplate(l.routine.instructions, values) },
        });
      } else return fail("This listing is broken.", 422);

      ref?.update({ installs: FieldValue.increment(1) }).catch(() => undefined);
      return NextResponse.json({ ok: true, kind: l.kind, names });
    }

    if (action === "publish") {
      const v = validatePublish(b.listing);
      if (!v.ok) return fail(v.error);
      const bad = unsafe(textOf(v.value));
      if (bad) return fail(bad, 422);
      const col = db.collection(COL);
      const mine = await col.where("ownerUid", "==", uid).limit(MAX_LISTINGS_PER_USER + 1).get();
      if (mine.size >= MAX_LISTINGS_PER_USER) return fail(`You can share up to ${MAX_LISTINGS_PER_USER} listings. Remove one first.`, 409);
      const author = String(b.author ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "Community member";
      const id = "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      const doc: Doc = JSON.parse(JSON.stringify({ ...v.value, author, ownerUid: uid, status: "live", reports: 0, installs: 0, createdAt: Date.now() }));
      await col.doc(id).set(doc);
      return NextResponse.json({ ok: true, listing: pub(id, doc) });
    }

    if (action === "mine") {
      const snap = await db.collection(COL).where("ownerUid", "==", uid).limit(MAX_LISTINGS_PER_USER + 1).get();
      const items = snap.docs.map((d) => { const x = d.data() as Doc; return { ...pub(d.id, x), status: x.status, reports: x.reports }; })
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return NextResponse.json({ items });
    }

    if (action === "remove") {
      const id = String(b.id || "");
      if (!LISTING_ID.test(id)) return fail("Bad listing id.");
      const ref = db.collection(COL).doc(id);
      const s = await ref.get();
      if (!s.exists) return fail("Listing not found.", 404);
      if ((s.data() as Doc).ownerUid !== uid) return fail("You can only remove your own listings.", 403);
      await ref.delete();
      return NextResponse.json({ ok: true });
    }

    if (action === "report") {
      const id = String(b.id || "");
      if (!LISTING_ID.test(id)) return fail("Only community listings can be reported.");
      const ref = db.collection(COL).doc(id);
      const reason = String(b.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      await db.runTransaction(async (t) => {
        const rr = ref.collection("reports").doc(uid);
        const [rs, ls] = await Promise.all([t.get(rr), t.get(ref)]);
        if (!ls.exists) throw new RequestError("Listing not found.", 404);
        if (rs.exists) return; // one report per person
        const n = ((ls.data() as Doc).reports || 0) + 1;
        t.set(rr, { at: Date.now(), reason });
        t.update(ref, n >= HIDE_AFTER_REPORTS ? { reports: n, status: "hidden" } : { reports: n });
      });
      return NextResponse.json({ ok: true });
    }

    return fail("Unknown action.");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Marketplace request failed." }, { status: requestStatus(e) });
  }
}
