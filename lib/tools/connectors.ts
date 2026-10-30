import { getAdminDb } from "@/lib/firebase-admin";
import { isPlaceholder, resolveValue, vaultPut } from "@/lib/vault";
import type { ToolCtx } from "./types";

/**
 * Opens every saved connector on its own. One connector whose secret cannot be read
 * (for example after the server key changed) no longer breaks all the others:
 * it is reported in `broken` so the UI can say "reconnect".
 */
export async function resolveConnectorsSafe(uid: string, stored: Record<string, string>): Promise<{ connectors: Record<string, string>; broken: string[] }> {
  const connectors: Record<string, string> = {};
  const broken: string[] = [];
  for (const [k, v] of Object.entries(stored)) {
    if (typeof v !== "string") continue;
    if (!isPlaceholder(v)) { connectors[k] = v; continue; }
    try { connectors[k] = await resolveValue(uid, v); } catch { broken.push(k); }
  }
  return { connectors, broken };
}

/** The name a connector gets inside the encrypted vault (the Connectors window uses the same rule). */
export const vaultNameFor = (chatId: string, key: string) => `conn.${chatId.toLowerCase()}.${key.toLowerCase().replace(/[^a-z0-9:]+/g, "_")}`;

/** Lets a tool save something for this chat (token refresh, the agent's inbox login, a connector the owner asked for in the chat) into the encrypted vault. */
export function makeCtx(uid: string, chatId: string, site?: { baseUrl?: string; origin?: string }): ToolCtx {
  const chatRef = getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId);
  return {
    uid, chatId,
    baseUrl: site?.baseUrl, origin: site?.origin,
    save: async (key, value) => {
      const ph = await vaultPut(uid, vaultNameFor(chatId, key), value);
      await chatRef.update({ [`connectors.${key}`]: ph });
    },
  };
}
