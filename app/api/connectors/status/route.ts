import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus } from "@/lib/request";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { syncConnectorAnnouncements } from "@/lib/connector-announce";

export const runtime = "nodejs";
export const maxDuration = 60;

type Custom = { type: "mcp" | "api"; host: string; url?: string; oauth: boolean };

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
    const connected = Object.keys(stored).filter((k) => !k.startsWith("auto:"));

    // Light mode: only "what is connected" (the Connect card in the chat polls this while the owner signs in).
    if (b.light === true) return NextResponse.json({ connected });

    const { connectors, broken } = await resolveConnectorsSafe(uid, stored);
    const accounts: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.connectorStatus ?? {})) if (v?.account) accounts[k] = v.account;

    // What the Custom tab shows for each MCP / API connector. The address is only sent for sign-in (OAuth) servers,
    // which is all "Reconnect" needs; other addresses can contain a key, so only the host is shown.
    const custom: Record<string, Custom> = {};
    for (const [k, v] of Object.entries(connectors)) {
      const type = k.startsWith("mcp:") ? "mcp" : k.startsWith("api:") ? "api" : null;
      if (!type) continue;
      try {
        const j = JSON.parse(v) as { url?: string; baseUrl?: string; oauth?: unknown };
        const addr = String(j.url ?? j.baseUrl ?? "");
        const oauth = Boolean(j.oauth);
        let host = "";
        try { host = new URL(addr).hostname; } catch { /* ignore */ }
        custom[k] = { type, host, oauth, ...(type === "mcp" && oauth ? { url: addr } : {}) };
      } catch { /* unreadable entry: it is listed from the keys */ }
    }

    const synced = b.sync === true ? await syncConnectorAnnouncements(uid, chatId).catch(() => ({ posted: false })) : { posted: false };
    return NextResponse.json({ broken, accounts, connected, custom, posted: synced.posted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Status failed." }, { status: requestStatus(e) });
  }
}
