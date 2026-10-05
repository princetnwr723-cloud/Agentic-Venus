import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody } from "@/lib/request";
import { audit } from "@/lib/audit";
import { resolveDeep, vaultPut } from "@/lib/vault";
import { buildCatalog, callTool } from "@/lib/tools/registry";
import type { ToolCtx } from "@/lib/tools/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function clean(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { allowJob: true });
    const uid = String(body.uid);
    const chatId = String(body.chatId || "");
    if (!chatId) return NextResponse.json({ ok: false, text: "chatId is missing." }, { status: 400 });

    // Connectors are ALWAYS read from the server's copy (the client cannot inject its own), then decrypted here.
    const chatRef = getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId);
    const snap = await chatRef.get();
    const stored = clean((snap.data() as { connectors?: unknown } | undefined)?.connectors);
    const connectors = (await resolveDeep(uid, { connectors: stored })).connectors;

    if (body.action === "list") return NextResponse.json(await buildCatalog(connectors));

    if (body.action === "call") {
      const ctx: ToolCtx = {
        uid, chatId,
        save: async (key, value) => {
          const ph = await vaultPut(uid, `conn.${chatId.toLowerCase()}.${key.toLowerCase().replace(/[^a-z0-9:]+/g, "_")}`, value);
          await chatRef.update({ [`connectors.${key}`]: ph });
        },
      };
      const name = String(body.name || "");
      const r = await callTool(connectors, name, body.args, body.approved === true, { force: body.force === true, ctx });
      if (r.ok && r.risk === "write") {
        await audit(uid, { kind: "tool_write", chatId, text: `${name} ${JSON.stringify(body.args ?? {}).slice(0, 220)} approved=${body.approved === true} tainted=${body.force === true}` });
      }
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, text: err instanceof Error ? err.message : "Tool request failed." }, { status: 500 });
  }
}
