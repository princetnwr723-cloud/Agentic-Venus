import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "skill";

function cleanMem(x: any) {
  const kind = ["fact", "preference", "lesson", "role"].includes(x?.kind) ? x.kind : "fact";
  return {
    id: str(x?.id, 40) || "m" + Date.now().toString(36), text: str(x?.text, 400), at: num(x?.at) || Date.now(),
    ...(x?.auto ? { auto: true } : {}), kind, weight: Math.min(3, Math.max(1, num(x?.weight) || 1)),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, body.uid);
    if (auth.job) return fail("Not available to background jobs.", 403);
    const chatId = String(body.chatId || "");
    if (!ID.test(chatId)) return fail("Bad chat id.", 400);
    const db = getAdminDb();
    const user = db.collection("users").doc(auth.uid);
    const base = user.collection("chats").doc(chatId);
    const memRef = base.collection("brain").doc("memories");
    const skills = base.collection("skills");
    const action = String(body.action || "");

    switch (action) {
      case "load": {
        const [m, k] = await Promise.all([memRef.get(), skills.get()]);
        return NextResponse.json({ memories: (m.data() as { items?: unknown[] } | undefined)?.items ?? [], skills: k.docs.map((d) => d.data()) });
      }
      case "mem_get":
        return NextResponse.json({ items: ((await memRef.get()).data() as { items?: unknown[] } | undefined)?.items ?? [] });
      case "mem_set": {
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map(cleanMem).filter((m: { text: string }) => m.text.trim());
        await memRef.set({ items });
        return NextResponse.json({ ok: true, count: items.length });
      }
      case "skill_put": {
        const k = body.skill ?? {};
        const name = str(k.name, 80).trim();
        const instructions = str(k.instructions, 20000).trim();
        if (!name || !instructions) return fail("A skill needs a name and instructions.", 400);
        const id = slug(name);
        const ref = skills.doc(id);
        const old = (await ref.get()).data() as Record<string, any> | undefined;
        if (!old && (await skills.get()).size >= 80) return fail("This chat already has 80 skills. Delete one first.", 400);
        const reset = Boolean(k.resetStats);
        const skill = {
          id, name, description: str(k.description, 300).trim(), instructions,
          ...(k.source ? { source: str(k.source, 300) } : {}), ...(k.auto ? { auto: true } : {}),
          uses: old?.uses ?? 0, wins: reset ? 0 : old?.wins ?? 0, fails: reset ? 0 : old?.fails ?? 0,
          version: num(k.version) || old?.version || 1, trial: typeof k.trial === "boolean" ? k.trial : old?.trial ?? false,
          disabled: reset ? false : old?.disabled ?? false,
          ...(k.prev ? { prev: str(k.prev, 20000) } : old?.prev ? { prev: old.prev } : {}), updatedAt: Date.now(),
        };
        await ref.set(skill);
        return NextResponse.json({ skill });
      }
      case "skill_patch": {
        const id = String(body.id || "");
        if (!ID.test(id)) return fail("Bad skill id.", 400);
        const p = body.patch ?? {};
        const upd: Record<string, unknown> = {};
        if (p.incUses) upd.uses = FieldValue.increment(1);
        for (const k of ["wins", "fails"]) if (p[k] !== undefined) upd[k] = Math.max(0, num(p[k]));
        for (const k of ["trial", "disabled"]) if (typeof p[k] === "boolean") upd[k] = p[k];
        await skills.doc(id).set(upd, { merge: true });
        return NextResponse.json({ ok: true });
      }
      case "skill_del": {
        const id = String(body.id || "");
        if (!ID.test(id)) return fail("Bad skill id.", 400);
        await skills.doc(id).delete();
        return NextResponse.json({ ok: true });
      }
      case "legacy": {
        const [m, k] = await Promise.all([user.collection("brain").doc("memories").get(), user.collection("skills").get()]);
        return NextResponse.json({ memories: (m.data() as { items?: unknown[] } | undefined)?.items ?? [], skills: k.docs.map((d) => d.data()) });
      }
      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Memory service failed.");
  }
}