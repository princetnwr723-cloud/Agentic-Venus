// All documentation data lives here, so you can edit text/ratings without touching the UI.

export const PRODUCT = {
  name: "AgenticVenus",
  tagline: "AI teammates that finish the work.",
  intro:
    "AgenticVenus gives you AI teammates with their own computer. They browse, code, make videos, call people, read your inbox and work in the background while you are away — and they only come back when a decision needs you.",
};

export type IconKey =
  | "monitor" | "code" | "film" | "users" | "brain" | "plug" | "key" | "phone"
  | "rocket" | "clock" | "shield" | "check" | "message" | "git" | "sparkles" | "layers";

export const FEATURES: Array<{ icon: IconKey; title: string; body: string; tag: string }> = [
  { icon: "monitor", title: "A real computer per chat", tag: "Computer", body: "Every chat gets a private Linux desktop (E2B) with Chrome, a terminal, LibreOffice and Python tools. You watch the screen live and can take control any time." },
  { icon: "rocket", title: "Background runner", tag: "Autonomy", body: "Jobs run inside the computer as a detached process. Close the tab — the work continues, and the report is posted in chat (and on Telegram / WhatsApp) when it ends." },
  { icon: "check", title: "Verified results, not claims", tag: "Trust", body: "Ask for 100 leads and the system only counts items that pass independent checks (live website, company found on page, email domain can receive mail). The final CSV is built by code, not by the model." },
  { icon: "key", title: "vPassword", tag: "Security", body: "Logins, cards and saved browser sessions that agents can use but never see. Values go straight into the page, only on the matching site. Cards ask you before every payment." },
  { icon: "code", title: "Venus Code", tag: "Build", body: "A coding agent with plan-first, read-before-edit, diagnostics after every edit, test/build gates, an independent code review of its own diff, git checkpoints and parallel writer sub-agents." },
  { icon: "film", title: "Venus Pro", tag: "Create", body: "Motion-graphics video studio (Remotion). The agent writes the storyboard, designs custom scenes as code, adds music and voice-over, reviews its own frames and renders 720p / 1080p." },
  { icon: "users", title: "63 specialists, one Chief", tag: "Team", body: "Chief plans a goal, picks the smallest team, and runs steps in parallel. Specialists cover research, sales, marketing, content, engineering, design, data, ops, finance and people." },
  { icon: "brain", title: "Memory & self-improving skills", tag: "Learning", body: "Memory is per chat — nothing leaks between chats. After tasks the agent keeps facts, creates trial skills, scores them, pauses failing ones and can roll back to the previous version." },
  { icon: "plug", title: "Connectors", tag: "Integrations", body: "GitHub, Google, Microsoft 365, Slack, Notion, Linear, HubSpot and more via OAuth, plus any MCP server or REST API. Write actions always ask for approval first." },
  { icon: "message", title: "Chat with it anywhere", tag: "Channels", body: "Talk to your agent from Telegram, WhatsApp, SMS or Slack DM. Only your own ID/number is answered. Risky actions ask 'reply YES to approve'." },
  { icon: "phone", title: "Voice & phone calls", tag: "Voice", body: "The agent can phone people with its own voice (Twilio), say it is an AI first, use read-only tools mid-call, and post a summary plus follow-ups in chat." },
  { icon: "clock", title: "Missions & routines", tag: "Scheduling", body: "Missions are long multi-step jobs (find leads → call each → update the sheet → report). Routines repeat a task on a schedule through your own scheduler." },
  { icon: "git", title: "GitHub in one sentence", tag: "Repos", body: "'clone owner/repo', edit files, 'push all changes'. Pushes go to a new branch by default, with a pull-request link. Tokens never touch .git/config." },
  { icon: "layers", title: "11 model providers", tag: "Models", body: "Claude, OpenAI, Gemini, Grok, OpenRouter, Mistral, Cohere, Perplexity, Groq, DeepSeek, Apinex. Bring your own keys; rate-limited? the server falls back to the next provider." },
  { icon: "shield", title: "Prompt-injection shield", tag: "Security", body: "Everything from the outside world (web pages, emails, tool output) is wrapped as untrusted data. If it tries to give instructions, the run is 'tainted' and even auto-approved writes need a human." },
  { icon: "sparkles", title: "Runs, cost & evals", tag: "Observability", body: "Every run is traced step by step with an estimated cost. A fixed 40-task evaluation suite is included to measure success rate over time." },
];

export const AGENTS = ["AgenticVenus", "OpenClaw", "Hermes Agent", "Grok-based bots", "OpenAI agents"] as const;

// scores are 0-10 per agent, in the same order as AGENTS. They are indicative and subjective.
export const RATINGS: Array<{ dim: string; why: string; scores: number[] }> = [
  { dim: "Own visible computer", why: "Desktop + browser + terminal you can watch and take over", scores: [8, 6, 6, 2, 7] },
  { dim: "Model freedom", why: "Bring your own keys, switch providers, fallback chain", scores: [9, 8, 9, 2, 2] },
  { dim: "Verified results", why: "Independent checks before a result is delivered", scores: [8, 5, 5, 3, 5] },
  { dim: "Secret handling", why: "Encrypted vault, approvals, agent never sees passwords", scores: [8, 6, 6, 7, 8] },
  { dim: "Memory & self-improvement", why: "Remembers, learns skills, fixes failing skills", scores: [7, 7, 9, 5, 6] },
  { dim: "Chat channels", why: "Telegram, WhatsApp, SMS, Slack, and more", scores: [6, 9, 8, 5, 6] },
  { dim: "Team / multi-agent", why: "Planner + specialists working in parallel", scores: [8, 6, 6, 3, 5] },
  { dim: "Setup ease (non-dev)", why: "How fast a non-technical person gets going", scores: [6, 5, 5, 9, 9] },
  { dim: "Maturity & community", why: "Age, users, docs, ecosystem", scores: [3, 9, 7, 7, 10] },
  { dim: "Self-host / data control", why: "Run it yourself, own your data", scores: [7, 10, 10, 1, 1] },
];

export type Cell = "yes" | "part" | "no";
export const MATRIX: Array<{ row: string; v: Cell[] }> = [
  { row: "Visible desktop computer", v: ["yes", "part", "part", "no", "part"] },
  { row: "Bring-your-own model keys", v: ["yes", "yes", "yes", "no", "no"] },
  { row: "Keeps working with the tab closed", v: ["yes", "yes", "yes", "part", "part"] },
  { row: "Independent result verification", v: ["yes", "no", "no", "no", "part"] },
  { row: "Encrypted vault + approvals", v: ["yes", "part", "part", "part", "yes"] },
  { row: "Self-improving skills", v: ["yes", "part", "yes", "no", "no"] },
  { row: "Chat apps (Telegram / WhatsApp / Slack)", v: ["yes", "yes", "yes", "part", "part"] },
  { row: "Phone calls with voice", v: ["yes", "part", "part", "no", "no"] },
  { row: "Built-in video studio", v: ["yes", "no", "no", "no", "no"] },
  { row: "Built-in coding workspace", v: ["yes", "part", "part", "no", "part"] },
  { row: "Multi-specialist team", v: ["yes", "part", "part", "no", "part"] },
  { row: "Self-hostable", v: ["yes", "yes", "yes", "no", "no"] },
];

export const BEST_AT = [
  { title: "Work that must be correct", body: "Lead lists, research and data tasks go through code-level verification. A short list is reported as short — it is never padded with guesses." },
  { title: "Work on real websites", body: "Logins, forms, downloads and sites with no API: the agent drives a real Chrome window on a desktop you can watch and take over." },
  { title: "Long jobs while you sleep", body: "Background runner + missions + routines + chat-app approvals mean work continues and you decide from your phone." },
  { title: "One place for build + create + outreach", body: "Code, video, email, calls and a 63-person team inside one product, each on its own computer so they never block each other." },
  { title: "Keeping your secrets safe", body: "AES-256-GCM vault bound to user + slot, vPassword, job tokens instead of raw keys, and a prompt-injection shield." },
];

export const HELPS = [
  { who: "Founders & operators", body: "Hand off lead sourcing, outreach drafts, inbox triage, expense sheets and weekly reports. Review only the exceptions." },
  { who: "Developers", body: "Clone a repo, ask for a fix or feature, get tests run, a self-review and a pull-request link — on a sandbox, not your laptop." },
  { who: "Agencies & creators", body: "Storyboard → custom animated scenes → voice-over → render. Same brand palette every time via memory." },
  { who: "Sales & recruiting teams", body: "Verified prospect/candidate lists with evidence per row, then calls or WhatsApp follow-ups with approval." },
];

export const LIMITS = [
  "Beta software built by a small team: expect rough edges and fast changes.",
  "Needs your own accounts: Firebase, E2B, Supabase (videos / proofs), Vercel, and AI provider keys.",
  "Vercel serverless functions have time limits (about 60 s); long work is therefore moved into the sandbox or sliced into missions.",
  "Email verification proves the domain can receive mail and that the address appears on a page — not that the mailbox exists.",
  "Temporary agent inboxes depend on free third-party services and can be blocked on some networks.",
  "Community, docs ecosystem and third-party skills are far smaller than the older open-source agents.",
  "Security features have unit tests but have not had an independent audit yet.",
];

export const FAQ = [
  { q: "Do my API keys leave my account?", a: "Keys are stored encrypted on the server. The browser only keeps a masked reference like vault:provider.openai#1234. They are decrypted server-side for a request and passed to your sandbox only for the length of a job." },
  { q: "What happens if I close the tab?", a: "Computer tasks and coding jobs run as detached processes in the sandbox. The scheduler tick finishes unattended jobs, posts the report, and switches the computer off to save credits." },
  { q: "Can the agent spend my money?", a: "Only through a vPassword card, and only after you approve each payment (site + amount shown). A per-payment limit is enforced on the server." },
  { q: "Is memory shared between agents?", a: "No. Memory and skills belong to one chat. 'Import old shared memory' on the Skills page copies legacy data into a chat on request." },
  { q: "Which model should I use?", a: "Computer tasks need a vision-capable model (Claude, GPT-4o, Gemini…). Coding and writing work with any provider. The router uses a stronger model for planning and a faster one for reports when your provider has both." },
  { q: "How do I add a tool that is not listed?", a: "Connectors → Custom → search the service name (MCP registry) or paste an MCP / REST URL. Write actions ask for approval." },
];

export const ENV_VARS: Array<{ name: string; need: "required" | "optional"; note: string }> = [
  { name: "NEXT_PUBLIC_FIREBASE_* (6 values)", need: "required", note: "Firebase web config: auth + Firestore." },
  { name: "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY", need: "required", note: "Service account for server routes, runners and ticks." },
  { name: "VAULT_KEY", need: "required", note: "32-byte base64 key for the vault. Generate one at /setup." },
  { name: "ROUTINE_RUNNER_SECRET", need: "required", note: "32+ chars. Signs job tokens and protects the tick endpoints." },
  { name: "NEXT_PUBLIC_APP_URL", need: "required", note: "Your public https URL (voice, channels and OAuth callbacks)." },
  { name: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", need: "required", note: "Private storage for videos, proofs, backups." },
  { name: "PEXELS_API_KEY", need: "optional", note: "Stock photos and footage for Venus Pro." },
  { name: "TAVILY_API_KEY", need: "optional", note: "Better web search results." },
  { name: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (and others)", need: "optional", note: "Enable each OAuth provider in Connectors." },
];