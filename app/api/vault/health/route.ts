import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus } from "@/lib/request";
import { placeholderName, vaultCheck } from "@/lib/vault";
import { loadKeys } from "@/lib/vault-crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { uid } = await readBody(req, { maxBytes: 2 * 1024 });
    const user = getAdminDb().collection("users").doc(uid);
    const d = ((await user.get()).data() ?? {}) as {
      apiKeys?: Record<string, string>; e2bKey?: string; pcCredentials?: Record<string, { email?: string; password?: string }>;
      voiceSettings?: Record<string, unknown>;
    };
    const items: Array<{ label: string; ph: unknown; fix: string }> = [];
    for (const [p, v] of Object.entries(d.apiKeys ?? {})) items.push({ label: `API key · ${p}`, ph: v, fix: "Open API keys and paste this key again." });
    items.push({ label: "E2B computer key", ph: d.e2bKey, fix: "Open API keys → Computer (E2B) and paste it again." });
    for (const [site, c] of Object.entries(d.pcCredentials ?? {})) {
      items.push({ label: `Saved login · ${site}`, ph: c?.email, fix: "Delete it and let the agent ask for the login again." });
      items.push({ label: `Saved login · ${site} (password)`, ph: c?.password, fix: "Same as above." });
    }
    for (const [k, v] of Object.entries(d.voiceSettings ?? {})) if (typeof v === "string" && v.startsWith("vault:")) items.push({ label: `Voice · ${k}`, ph: v, fix: "Open Voice & Calling and save it again." });
    const chats = await user.collection("chats").limit(50).get();
    for (const c of chats.docs) {
      const cd = c.data() as { agentName?: string; connectors?: Record<string, string> };
      for (const [k, v] of Object.entries(cd.connectors ?? {})) if (!k.startsWith("auto:")) items.push({ label: `Connector · ${k} (${cd.agentName ?? c.id})`, ph: v, fix: "Open Connectors and press Reconnect." });
    }
    const bad: Array<{ label: string; fix: string }> = [];
    let total = 0;
    for (const it of items) {
      const name = placeholderName(it.ph);
      if (!name) continue;
      total++;
      if ((await vaultCheck(uid, name)) === "unreadable") bad.push({ label: it.label, fix: it.fix });
    }
    let keyMode = "unknown";
    try { keyMode = loadKeys().derivedOnly ? "derived (no VAULT_KEY set)" : "dedicated VAULT_KEY"; } catch { /* no key at all */ }
    return NextResponse.json({ ok: bad.length === 0, total, bad, keyMode });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Health check failed." }, { status: requestStatus(e) });
  }
}