export type Field = { key: string; placeholder: string; secret?: boolean };
export type PluginMeta = {
  id: string; label: string; note: string; keysUrl?: string; fields: Field[];
  tools: Array<{ name: string; risk: "read" | "write" }>;
};

export const FREE_PACK = {
  label: "Built in",
  note: "Always on. No key needed. Web, weather, wiki, currency, RSS, the verifiers (leads, facts, links), phone calls (voice.call), missions (long background jobs) and notify.send (message the owner).",
  tools: [
    "web.search", "web.read", "weather.now", "wiki.summary", "currency.convert", "rss.read",
    "verify.leads", "verify.facts", "verify.urls", "voice.call ✎", "voice.calls", "mission.start ✎", "mission.status", "notify.send",
  ],
};

// Only the tools people need most. Everything else: add an MCP server in the Custom tab (search by name).
export const PLUGINS: PluginMeta[] = [
  {
    id: "github", label: "GitHub",
    note: "Search issues and PRs, read files, open issues, comment, open pull requests, commit to a branch. Free personal access token.",
    keysUrl: "https://github.com/settings/tokens",
    fields: [{ key: "token", placeholder: "ghp_… or github_pat_…", secret: true }],
    tools: [
      { name: "github.search_issues", risk: "read" }, { name: "github.list_repos", risk: "read" },
      { name: "github.get_file", risk: "read" }, { name: "github.create_issue", risk: "write" },
      { name: "github.list_pull_requests", risk: "read" }, { name: "github.get_pull_request", risk: "read" },
      { name: "github.comment", risk: "write" }, { name: "github.create_pull_request", risk: "write" },
      { name: "github.commit_files", risk: "write" },
    ],
  },
  {
    id: "notion", label: "Notion (token)",
    note: "Search and create pages. Make a free internal integration, then share your pages with it. For full access use the Notion MCP server (Custom tab).",
    keysUrl: "https://www.notion.so/profile/integrations",
    fields: [{ key: "token", placeholder: "secret_… / ntn_…", secret: true }],
    tools: [{ name: "notion.search", risk: "read" }, { name: "notion.create_page", risk: "write" }],
  },
  {
    id: "telegram", label: "Telegram (chat with your agent)",
    note: "Talk to this agent from Telegram AND get its reports there. Make a free bot with @BotFather, get your chat id from @userinfobot. Only your chat id can command it.",
    keysUrl: "https://t.me/BotFather",
    fields: [{ key: "token", placeholder: "123456:ABC… (bot token)", secret: true }, { key: "chat", placeholder: "your chat id (numbers)" }],
    tools: [{ name: "telegram.send", risk: "write" }],
  },
  {
    id: "whatsapp", label: "WhatsApp (via Twilio)",
    note: "Chat with your agent on WhatsApp and get reports there. Uses the Twilio account from the Voice page. Only your number can command it. Start with the free Twilio WhatsApp sandbox (+14155238886).",
    keysUrl: "https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn",
    fields: [{ key: "owner", placeholder: "YOUR WhatsApp number, e.g. +919876543210" }, { key: "from", placeholder: "Twilio WhatsApp number, e.g. +14155238886 (sandbox)" }],
    tools: [{ name: "whatsapp.send", risk: "write" }],
  },
  {
    id: "sms", label: "SMS (via Twilio)",
    note: "Text your agent and get reports by SMS. Uses the Twilio account from the Voice page. Only your number can command it.",
    fields: [{ key: "owner", placeholder: "YOUR mobile number, e.g. +919876543210" }, { key: "from", placeholder: "Your Twilio number, e.g. +12025550123" }],
    tools: [{ name: "sms.send", risk: "write" }],
  },
  {
    id: "slackbot", label: "Slack (chat with your agent)",
    note: "DM your agent in Slack. Create a Slack app (bot scopes chat:write, im:history, im:read; subscribe to message.im), install it, then paste the bot token, the signing secret and your own member ID.",
    keysUrl: "https://api.slack.com/apps",
    fields: [{ key: "bot", placeholder: "Bot token xoxb-…", secret: true }, { key: "signing", placeholder: "Signing secret", secret: true }, { key: "owner", placeholder: "Your Slack member ID (U0123…)" }],
    tools: [{ name: "slackbot.send", risk: "write" }],
  },
  {
    id: "email", label: "Email (Resend)",
    note: "The agent can email you its reports and send emails. Free key at resend.com. 'From' can be onboarding@resend.dev while testing (then it can only email your own address).",
    keysUrl: "https://resend.com/api-keys",
    fields: [{ key: "key", placeholder: "re_… (Resend API key)", secret: true }, { key: "from", placeholder: "Agent <onboarding@resend.dev>" }, { key: "to", placeholder: "Your email (reports go here)" }],
    tools: [{ name: "email.send", risk: "write" }],
  },
  {
    id: "webhook", label: "Slack / Discord webhook",
    note: "Post a message to a channel with a free incoming-webhook URL.",
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