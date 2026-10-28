import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  addMemoryDetailed, appendProgress, deleteSkillFile, forgetMemoryServer, getSkill, mergeMemories, outcomeSkills, ownerShared,
  patchSkillServer, readAgentFiles, readOwner, recallSearch, removeMemoryById, rollbackSkill, saveSkillServer, setOwnerShared,
  setRoleServer, writeAgentFiles, writeSkillFile,
} from "@/lib/learning";
import { MEM_CAP } from "@/lib/learn-utils";

export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const msg = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

function cleanMem(x: any) {
  const kind = ["fact", "preference", "lesson", "role", "profile"].includes(x?.kind) ? x.kind : "fact";
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
    const uid = auth.uid;
    const db = getAdminDb();
    const user = db.collection("users").doc(uid);
    const base = user.collection("chats").doc(chatId);
    const memRef = base.collection("brain").doc("memories");
    const skills = base.collection("skills");
    const action = String(body.action || "");

    switch (action) {
      case "load": {
        const [m, k, files, owner, shared] = await Promise.all([
          memRef.get(), skills.get(), readAgentFiles(uid, chatId).catch(() => null), readOwner(uid).catch(() => []), ownerShared(uid),
        ]);
        return NextResponse.json({
          memories: (m.data() as { items?: unknown[] } | undefined)?.items ?? [],
          skills: k.docs.map((d: any) => d.data()),
          files: files ? { soul: files.soul, memory: files.memory } : null,
          owner, shareOwner: shared,
        });
      }
      case "files_get":
        return NextResponse.json(await readAgentFiles(uid, chatId));
      case "files_set": {
        const patch: { soul?: string; memory?: string } = {};
        if (typeof body.soul === "string") patch.soul = body.soul;
        if (typeof body.memory === "string") patch.memory = body.memory;
        if (!Object.keys(patch).length) return fail("Nothing to save.", 400);
        await writeAgentFiles(uid, chatId, patch);
        return NextResponse.json({ ok: true });
      }
      case "files_log": {
        await appendProgress(uid, chatId, str(body.line, 400));
        return NextResponse.json({ ok: true });
      }

      // ---- memory (every write below is a server transaction) ----
      case "mem_get":
        return NextResponse.json({ items: ((await memRef.get()).data() as { items?: unknown[] } | undefined)?.items ?? [] });
      case "mem_add": {
        const kind = ["fact", "preference", "lesson", "profile"].includes(body.kind) ? body.kind : "fact";
        const r = await addMemoryDetailed(uid, chatId, str(body.text, 400), { auto: Boolean(body.auto), kind, weight: num(body.weight) || 1 });
        return NextResponse.json({ mem: r.mem, scope: r.scope });
      }
      case "mem_remove": {
        const id = str(body.id, 40);
        if (!id) return fail("Bad memory id.", 400);
        return NextResponse.json({ ok: await removeMemoryById(uid, chatId, id) });
      }
      case "mem_forget":
        return NextResponse.json({ removed: await forgetMemoryServer(uid, chatId, str(body.query, 200)) });
      case "mem_merge": {
        const removeIds = (Array.isArray(body.removeIds) ? body.removeIds : []).map((x: unknown) => str(x, 40)).filter(Boolean).slice(0, MEM_CAP);
        const merged = (Array.isArray(body.merged) ? body.merged : []).slice(0, 60).map((m: any) => ({ text: str(m?.text, 400), kind: str(m?.kind, 12), weight: num(m?.weight) }));
        return NextResponse.json({ added: await mergeMemories(uid, chatId, removeIds, merged) });
      }
      case "role_set":
        return NextResponse.json({ role: await setRoleServer(uid, chatId, str(body.text, 400)) });
      case "mem_set": { // kept for old clients: replaces the whole list. New code uses mem_add / mem_remove / mem_forget / role_set.
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, MEM_CAP).map(cleanMem).filter((m: { text: string }) => m.text.trim());
        await memRef.set({ items });
        return NextResponse.json({ ok: true, count: items.length });
      }
      case "owner_get":
        return NextResponse.json({ items: await readOwner(uid), shared: await ownerShared(uid) });
      case "owner_settings": {
        await setOwnerShared(uid, body.shareOwnerProfile !== false);
        return NextResponse.json({ ok: true, shared: body.shareOwnerProfile !== false });
      }
      case "recall":
        return NextResponse.json({ text: await recallSearch(uid, chatId, str(body.query, 300), { deep: Boolean(body.deep) }) });

      // ---- skills ----
      case "skill_put": {
        const k = body.skill ?? {};
        const name = str(k.name, 80).trim();
        const instructions = str(k.instructions, 20000).trim();
        if (!name || !instructions) return fail("A skill needs a name and instructions.", 400);
        try {
          const skill = await saveSkillServer(uid, chatId, {
            name, description: str(k.description, 300), instructions,
            tags: Array.isArray(k.tags) && k.tags.length ? k.tags.map(String) : undefined,
            source: k.source ? str(k.source, 300) : undefined, auto: Boolean(k.auto),
            trial: typeof k.trial === "boolean" ? k.trial : undefined, resetStats: Boolean(k.resetStats),
            files: k.files === null ? null : k.files && typeof k.files === "object" ? k.files : undefined,
          });
          return NextResponse.json({ skill });
        } catch (e) { return fail(msg(e, "Could not save the skill."), 400); }
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
      case "skill_edit": {
        try {
          const r = await patchSkillServer(uid, chatId, {
            name: str(body.name, 80), oldStr: str(body.oldStr, 20000), newStr: str(body.newStr, 20000),
            replaceAll: Boolean(body.replaceAll), file: body.file ? str(body.file, 120) : undefined,
          });
          return NextResponse.json({ skill: r.skill, count: r.count });
        } catch (e) { return fail(msg(e, "Could not change the skill."), 400); }
      }
      case "skill_file_put": {
        try { return NextResponse.json({ skill: await writeSkillFile(uid, chatId, { name: str(body.name, 80), path: str(body.path, 120), content: str(body.content, 20000) }) }); }
        catch (e) { return fail(msg(e, "Could not save the file."), 400); }
      }
      case "skill_file_del":
        return NextResponse.json({ ok: await deleteSkillFile(uid, chatId, { name: str(body.name, 80), path: str(body.path, 120) }) });
      case "skill_rollback": {
        try { return NextResponse.json({ skill: await rollbackSkill(uid, chatId, str(body.name, 80)) }); }
        catch (e) { return fail(msg(e, "Could not roll back."), 400); }
      }
      case "skill_outcome": {
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x: string) => ID.test(x)).slice(0, 5);
        const verdict = body.verdict === "pass" || body.verdict === "fail" ? body.verdict : "partial";
        return NextResponse.json({ events: await outcomeSkills(uid, chatId, ids, verdict) });
      }
      case "skill_feedback": {
        const names = (Array.isArray(body.names) ? body.names : []).map((x: unknown) => str(x, 80)).slice(0, 5);
        const found = (await Promise.all(names.map((n: string) => getSkill(uid, chatId, n)))).filter((x): x is NonNullable<typeof x> => Boolean(x));
        const events = await outcomeSkills(uid, chatId, found.map((x) => x.id), Number(body.thumbs) > 0 ? "pass" : "fail");
        return NextResponse.json({ events });
      }
      case "skill_del": {
        const id = String(body.id || "");
        if (!ID.test(id)) return fail("Bad skill id.", 400);
        await skills.doc(id).delete();
        return NextResponse.json({ ok: true });
      }
      case "legacy": {
        const [m, k] = await Promise.all([user.collection("brain").doc("memories").get(), user.collection("skills").get()]);
        return NextResponse.json({ memories: (m.data() as { items?: unknown[] } | undefined)?.items ?? [], skills: k.docs.map((d: any) => d.data()) });
      }
      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Memory service failed.");
  }
}
