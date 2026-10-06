export type Field = { key: string; placeholder: string; secret?: boolean };
export type PluginMeta = {
  id: string; label: string; note: string; keysUrl?: string; fields: Field[];
  tools: Array<{ name: string; risk: "read" | "write" }>;
};

export const FREE_PACK = {
  label: "Free pack",
  note: "Always on. No key, no account. Includes the verifiers that check leads, facts and links before the agent delivers them.",
  tools: ["web.search", "web.read", "weather.now", "wiki.summary", "currency.convert", "rss.read", "verify.leads", "verify.facts", "verify.urls"],
};

// Only the tools people need most. Everything else: add an MCP server in the Custom tab.
export const PLUGINS: PluginMeta[] = [
  {
    id: "github", label: "GitHub",
    note: "Search issues, read files, list repos, open issues. Free personal access token.",
    keysUrl: "https://github.com/settings/tokens",
    fields: [{ key: "token", placeholder: "ghp_… or github_pat_…", secret: true }],
    tools: [
      { name: "github.search_issues", risk: "read" }, { name: "github.list_repos", risk: "read" },
      { name: "github.get_file", risk: "read" }, { name: "github.create_issue", risk: "write" },
    ],
  },
  {
    id: "notion", label: "Notion",
    note: "Search and create pages. Make a free internal integration, then share your pages with it.",
    keysUrl: "https://www.notion.so/profile/integrations",
    fields: [{ key: "token", placeholder: "secret_… / ntn_…", secret: true }],
    tools: [{ name: "notion.search", risk: "read" }, { name: "notion.create_page", risk: "write" }],
  },
  {
    id: "telegram", label: "Telegram",
    note: "The agent messages YOU (reports, alerts). Free bot from @BotFather; get your chat id from @userinfobot.",
    keysUrl: "https://t.me/BotFather",
    fields: [{ key: "token", placeholder: "123456:ABC… (bot token)", secret: true }, { key: "chat", placeholder: "your chat id" }],
    tools: [{ name: "telegram.send", risk: "write" }],
  },
  {
    id: "webhook", label: "Slack / Discord webhook",
    note: "Post to a channel with a free incoming-webhook URL.",
    fields: [{ key: "url", placeholder: "https://hooks.slack.com/… or https://discord.com/api/webhooks/…", secret: true }],
    tools: [{ name: "webhook.send", risk: "write" }],
  },
  {
    id: "identity", label: "Agent email (identity)",
    note: "Gives the agent its OWN free temporary inbox to sign up for services and read verification codes and links. It is not your email.",
    fields: [],
    tools: [
      { name: "identity.inbox", risk: "read" }, { name: "identity.list_mail", risk: "read" },
      { name: "identity.read_mail", risk: "read" }, { name: "identity.wait_for_mail", risk: "read" },
    ],
  },
  {
    id: "vercel", label: "Vercel (deploy)",
    note: "Lets /deploy publish your site. Not an agent tool.",
    keysUrl: "https://vercel.com/account/tokens",
    fields: [{ key: "token", placeholder: "Vercel token", secret: true }],
    tools: [],
  },
];

export const unpack = (v: string) => v.split("::");
export const safeId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "x";