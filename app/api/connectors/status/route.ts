import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus } from "@/lib/request";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { syncConnectorAnnouncements } from "@/lib/connector-announce";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 4 * 1024 });
    const uid = String(b.uid);
    const chatId = String(b.chatId || "");
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ error: "Valid chatId is required." }, { status: 400 });
    const snap = await getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId).get();
    const data = (snap.data() ?? {}) as { connectors?: Record<string, string>; connectorStatus?: Record<string, { account?: string }> };
    const stored: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.connectors ?? {})) if (typeof v === "string") stored[k] = v;
    const { broken } = await resolveConnectorsSafe(uid, stored);
    const accounts: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.connectorStatus ?? {})) if (v?.account) accounts[k] = v.account;
    const synced = b.sync === true ? await syncConnectorAnnouncements(uid, chatId).catch(() => ({ posted: false })) : { posted: false };
    return NextResponse.json({ broken, accounts, posted: synced.posted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Status failed." }, { status: requestStatus(e) });
  }
}