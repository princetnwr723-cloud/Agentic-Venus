import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { attachmentUrl, findAttachment, listAttachments, markReady, signAttachment } from "@/lib/attachments-server";
import { ATTACH_ID } from "@/lib/attachments";

export const runtime = "nodejs";
export const maxDuration = 30;

// sign  → one-time upload link (the browser sends the file straight to storage)
// ready → the upload finished
// links → fresh download links for files of this chat (used when the task goes to the computer / Venus Code)
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const chatId = String(body.chatId || "");
    if (!chatId) return NextResponse.json({ error: "chatId is missing." }, { status: 400 });

    if (body.action === "sign") return NextResponse.json(await signAttachment(uid, chatId, { name: body.name, size: body.size, mime: body.mime }));

    if (body.action === "ready") {
      const id = String(body.id || "");
      await markReady(uid, chatId, id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "links") {
      const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).map((x: unknown) => String(x)).filter((x: string) => ATTACH_ID.test(x)).slice(0, 12);
      const out: Array<{ id: string; name: string; url: string }> = [];
      for (const id of ids) {
        const a = await findAttachment(uid, chatId, id);
        if (a) out.push({ id: a.id, name: a.name, url: await attachmentUrl(a, 6 * 3600) });
      }
      return NextResponse.json({ files: out });
    }

    if (body.action === "list") return NextResponse.json({ files: (await listAttachments(uid, chatId)).map(({ path: _p, ...rest }) => rest) });

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Attachment request failed." }, { status: requestStatus(err) });
  }
}