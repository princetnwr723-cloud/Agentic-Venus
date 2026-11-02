import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus } from "@/lib/request";
import { saveSkillServer } from "@/lib/learning";
import { sanitizeTemplate, templateSkill, type TemplateListItem, type VideoTemplate } from "@/lib/venus-clone";

export const runtime = "nodejs";
export const maxDuration = 30;

// Saved video templates of the account (the look, pace and structure of a real video).
//   list   → short items, newest first
//   get    → one full template
//   save   → sanitize what the model returned, store it, and save a "video" skill in the chat so the agent knows it
//   delete → remove it
const col = (uid: string) => getAdminDb().collection("users").doc(uid).collection("venusTemplates");
const cleanId = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const action = String(body.action || "");

    if (action === "list") {
      const snap = await col(uid).orderBy("createdAt", "desc").limit(60).get();
      const templates: TemplateListItem[] = snap.docs.map((d) => {
        const t = d.data() as VideoTemplate;
        return { id: t.id, name: t.name, category: t.category, summary: t.summary, seconds: t.seconds, aspect: t.aspect, createdAt: t.createdAt, sourceName: t.sourceName };
      });
      return NextResponse.json({ templates });
    }

    if (action === "get") {
      const snap = await col(uid).doc(cleanId(body.id)).get();
      if (!snap.exists) return NextResponse.json({ error: "Template not found." }, { status: 404 });
      return NextResponse.json({ template: snap.data() });
    }

    if (action === "save") {
      const t = sanitizeTemplate(body.template, {
        name: typeof body.name === "string" ? body.name : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        aspect: typeof body.aspect === "string" ? body.aspect : undefined,
        sourceName: typeof body.sourceName === "string" ? body.sourceName : undefined,
        sourceSeconds: Number(body.sourceSeconds) || undefined,
      });
      if (t.structure.length < 2) return NextResponse.json({ error: "The analysis found no scenes. Try again, or use a clearer video." }, { status: 422 });
      await col(uid).doc(t.id).set(JSON.parse(JSON.stringify(t)));
      // the skill lives in the chat where the video was shown, so that chat's agent knows the template
      let skill: string | null = null;
      const chatId = cleanId(body.chatId);
      if (chatId) {
        try {
          const sk = templateSkill(t);
          const saved = await saveSkillServer(uid, chatId, { name: sk.name, description: sk.description, instructions: sk.instructions, files: sk.files, tags: ["video"], auto: false, trial: false });
          skill = saved.name;
        } catch { /* the template is saved anyway */ }
      }
      return NextResponse.json({ template: t, skill });
    }

    if (action === "delete") {
      await col(uid).doc(cleanId(body.id)).delete();
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Template request failed." }, { status: requestStatus(err) });
  }
}
