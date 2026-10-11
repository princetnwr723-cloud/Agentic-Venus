import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { buildCatalog } from "@/lib/tools/registry";
import { makeCtx, resolveConnectorsSafe } from "@/lib/tools/connectors";
import { OAUTH_PROVIDERS } from "@/lib/tools/oauth-catalog";
import { PLUGINS } from "@/lib/tools/catalog";
import type { ToolSpec } from "@/lib/tools/types";

const CAN: Record<string, string> = {
  "oauth:google": "read and send Gmail, read and write Google Sheets, read Drive files and manage Calendar events",
  "oauth:microsoft": "read and send Outlook mail, work with OneDrive and Excel files, and manage your calendar",
  "oauth:slack": "read channels, search messages and post in your workspace",
  "oauth:github_oauth": "read your repositories and issues",
  "oauth:notion_oauth": "read and write your Notion pages",
  "oauth:hubspot": "read CRM contacts, companies and deals",
  github: "search issues and pull requests, read files, open issues and PRs, and commit to branches",
  notion: "search Notion and create pages",
  telegram: "message you on Telegram and take your commands there",
  whatsapp: "message you on WhatsApp and take your commands there",
  sms: "text you and take your commands by SMS",
  slackbot: "chat with you in Slack direct messages",
  email: "send emails and email you reports",
  webhook: "post to your Slack or Discord channel",
  identity: "use its own temporary inbox to sign up for services and read verification codes",
  vercel: "deploy your sites with /deploy",
};
const TRY: Record<string, string> = {
  "oauth:google": 'Try: "Summarize my unread emails from today" or "Create a Google Sheet called Leads".',
  "oauth:microsoft": 'Try: "What is on my calendar tomorrow?"',
  github: 'Try: "List my open pull requests".',
  telegram: "Try: send me any message on Telegram.",
  whatsapp: "Try: send me any message on WhatsApp.",
  email: 'Try: "Email me a summary of today\'s work".',
};

function label(kind: string): string {
  if (kind.startsWith("oauth:")) return OAUTH_PROVIDERS.find((p) => p.id === kind.slice(6))?.label ?? kind;
  if (kind.startsWith("mcp:")) return `MCP · ${kind.slice(4)}`;
  if (kind.startsWith("api:")) return `API · ${kind.slice(4)}`;
  return PLUGINS.find((p) => p.id === kind)?.label ?? kind;
}

/**
 * Compares what is connected NOW with what the chat was last told about and, if something changed,
 * posts one clear English message ("Agent updated ...") into the chat. Called when the Connectors window
 * closes, after a connect, and by the OAuth callbacks. The agent's own tool list is rebuilt on every message.
 */
export async function syncConnectorAnnouncements(uid: string, chatId: string, opts: { added?: string[] } = {}): Promise<{ posted: boolean }> {
  const ref = getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) return { posted: false };
  const data = snap.data() as { connectors?: Record<string, string>; announced?: string[]; connectorStatus?: Record<string, { account?: string }> };
  const stored: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.connectors ?? {})) if (typeof v === "string") stored[k] = v;
  const current = Object.keys(stored).filter((k) => !k.startsWith("auto:"));
  const forced = new Set(opts.added ?? []);
  const base = new Set(data.announced ?? current.filter((k) => !forced.has(k))); // first run: no spam about old connections
  const added = current.filter((k) => !base.has(k));
  const removed = Array.from(base).filter((k) => !current.includes(k));
  if (!added.length && !removed.length) {
    if (!data.announced) await ref.update({ announced: current }).catch(() => {});
    return { posted: false };
  }

  const { connectors, broken } = await resolveConnectorsSafe(uid, stored);
  const cat = await Promise.race([
    buildCatalog(connectors, makeCtx(uid, chatId)),
    new Promise<{ specs: ToolSpec[]; errors: string[] }>((res) => setTimeout(() => res({ specs: [], errors: [] }), 12_000)),
  ]);

  const lines: string[] = [];
  for (const kind of added) {
    const own = cat.specs.filter((s) => s.source === kind);
    const acct = kind.startsWith("oauth:") ? data.connectorStatus?.[kind.slice(6)]?.account : "";
    const can = CAN[kind] ?? (own.length ? `use its tools: ${own.slice(0, 8).map((s) => s.name.split(".").pop()).join(", ")}${own.length > 8 ? ` (+${own.length - 8} more)` : ""}` : "use this connection");
    lines.push(`• **${label(kind)}**${acct ? ` (signed in as ${acct})` : ""}\n  I can now: ${can}.${TRY[kind] ? "\n  " + TRY[kind] : ""}`);
  }
  let text = "";
  if (added.length) text += `✅ **Agent updated.** New connection${added.length > 1 ? "s" : ""}:\n\n${lines.join("\n\n")}\n\nI have ${cat.specs.length} tools in total now and I will use them automatically when a task needs them. For long jobs I can start a mission that runs in the background.`;
  if (removed.length) text += `${text ? "\n\n" : ""}⚠️ **Agent updated.** Disconnected: ${removed.map((k) => `**${label(k)}**`).join(", ")}. I no longer have those tools.`;
  if (broken.length) text += `\n\n🔌 Needs reconnecting (saved login can't be opened): ${broken.map((k) => `**${label(k)}**`).join(", ")}.`;

  await ref.update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at: Date.now() }), announced: current });
  return { posted: true };
}