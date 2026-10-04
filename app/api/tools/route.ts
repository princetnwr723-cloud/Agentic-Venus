import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { buildCatalog, callTool } from "@/lib/tools/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

const hasAdmin = () => Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);

function clean(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const auth = await authFromRequest(req, body.uid);
    const chatId = auth.chatId ?? String(body.chatId || "");

    let connectors: Record<string, string>;
    if (hasAdmin() && chatId) {
      const snap = await getAdminDb().collection("users").doc(auth.uid).collection("chats").doc(chatId).get();
      connectors = clean((snap.data() as { connectors?: unknown } | undefined)?.connectors);
    } else if (auth.job) {
      return NextResponse.json({ error: "Background jobs need the Firebase Admin env vars (same ones Routines use)." }, { status: 500 });
    } else {
      connectors = clean(body.connectors);
    }

    if (body.action === "list") return NextResponse.json(await buildCatalog(connectors));
    if (body.action === "call") {
      const r = await callTool(connectors, String(body.name || ""), body.args, body.approved === true);
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, text: err instanceof Error ? err.message : "Tool request failed." }, { status: 500 });
  }
}
