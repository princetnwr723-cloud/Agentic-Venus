"use client";

import { CalendarDays, Check, FileText, Github, Mail, Slack } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";

function Win({ label, right, children }: { label: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm text-muted">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-line" />
          <i className="h-2.5 w-2.5 rounded-full bg-line" />
          <i className="h-2.5 w-2.5 rounded-full bg-line" />
        </span>
        <span className="text-ink/80">{label}</span>
        {right && <span className="ml-auto font-mono text-xs">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl2 border border-line bg-panel/60 p-7">
      <h3 className="text-2xl font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">{body}</p>
      <div className="mt-7 flex flex-1 flex-col justify-end">{children}</div>
    </div>
  );
}

const PROVIDERS = [
  { n: "Claude", by: "Anthropic", c: "#e8825c" },
  { n: "OpenAI", by: "GPT models", c: "#10a37f" },
  { n: "Gemini", by: "Google", c: "#5fa6f0" },
  { n: "Grok", by: "xAI", c: "#9a9aa2" },
  { n: "DeepSeek", by: "DeepSeek", c: "#4d6bfe" },
];

const CHANNELS = [
  { n: "Telegram", on: true },
  { n: "WhatsApp", on: true },
  { n: "SMS", on: true },
  { n: "Slack", on: false },
];

const NODES: { x: number; y: number; Icon: typeof Mail; on: boolean }[] = [
  { x: 50, y: 14, Icon: Mail, on: true },
  { x: 82, y: 38, Icon: Slack, on: true },
  { x: 82, y: 80, Icon: Github, on: true },
  { x: 18, y: 38, Icon: CalendarDays, on: false },
  { x: 18, y: 80, Icon: FileText, on: false },
];

export default function FeatureCards() {
  return (
    <section className="mx-auto grid max-w-6xl gap-5 px-6 pb-24 md:grid-cols-3">
      {/* brain */}
      <Card
        title="Pick a brain per bot"
        body="Claude, OpenAI, Gemini, Grok and more, side by side. Bring your own keys and switch a bot’s model mid-conversation."
      >
        <Win label="Sales Outbound · model">
          <div className="p-3">
            <div className="mb-2 flex items-center gap-3 px-2 py-1.5">
              <BotAvatar color={"red-fierce" as AvatarColor} size={34} />
              <div>
                <p className="text-sm font-medium text-ink">Sales Outbound</p>
                <p className="text-xs text-muted">thinking with OpenAI</p>
              </div>
            </div>
            {PROVIDERS.map((p) => (
              <div
                key={p.n}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                  p.n === "OpenAI" ? "border border-line bg-panel2" : ""
                }`}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-black"
                  style={{ background: p.c }}
                >
                  {p.n[0]}
                </span>
                <span className="text-ink">{p.n}</span>
                <span className="text-muted">{p.by}</span>
                {p.n === "OpenAI" && <Check size={16} className="ml-auto text-[#3fe08f]" />}
              </div>
            ))}
          </div>
        </Win>
      </Card>

      {/* connectors */}
      <Card
        title="Connected apps"
        body="Gmail, Slack, GitHub, Notion, Linear, HubSpot and more over OAuth, plus any MCP server. Connect once, every bot can use them."
      >
        <Win label="Connected apps" right="3/5 connected">
          <div className="relative h-[250px]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {NODES.map((n, i) => (
                <line
                  key={i}
                  x1="50"
                  y1="56"
                  x2={n.x}
                  y2={n.y}
                  stroke={n.on ? "#2f8f5e" : "#28282d"}
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {NODES.map(({ x, y, Icon, on }, i) => (
              <span
                key={i}
                className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-line bg-panel2 ${
                  on ? "text-ink" : "text-faint"
                }`}
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <Icon size={20} />
                {on && (
                  <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#2fb36f]">
                    <Check size={10} className="text-black" />
                  </span>
                )}
              </span>
            ))}
            <span className="absolute left-1/2 top-[56%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-panel p-1.5">
              <BotAvatar color={"bd.robot:#5fa6f0" as AvatarColor} size={46} />
            </span>
            <span className="absolute bottom-2 left-3 text-xs text-faint">OAuth · MCP</span>
          </div>
        </Win>
      </Card>

      {/* channels */}
      <Card
        title="Talk to them anywhere"
        body="Message your team from Telegram, WhatsApp, SMS or Slack. Risky actions ask first, so you just reply YES."
      >
        <Win label="Channels">
          <div className="space-y-2 p-3">
            {CHANNELS.map((c) => (
              <div key={c.n} className="flex items-center justify-between rounded-xl bg-panel px-4 py-3 text-sm">
                <span className="text-ink">{c.n}</span>
                <span className={`flex items-center gap-1.5 text-xs ${c.on ? "text-[#3fe08f]" : "text-faint"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${c.on ? "bg-[#3fe08f]" : "bg-faint"}`} />
                  {c.on ? "Connected" : "Not connected"}
                </span>
              </div>
            ))}
            <div className="rounded-xl bg-panel2 px-4 py-3 text-sm text-ink">
              Ready to send 4 reminders. Reply YES to approve.
            </div>
          </div>
        </Win>
      </Card>

      {/* voice */}
      <Card
        title="Bots that talk back"
        body="Your bot can phone people with its own voice, say it’s an AI first, and post a summary with follow-ups in chat."
      >
        <Win label="Live call" right="02:14">
          <div className="p-5">
            <div className="flex h-12 items-center justify-center gap-1">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="lv-bar h-10 w-1 origin-center rounded-full"
                  style={{
                    background: "var(--brand, #3fc9ae)",
                    animation: `lv-bar ${0.9 + (i % 5) * 0.15}s ease-in-out ${i * 0.07}s infinite`,
                  }}
                />
              ))}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <p className="rounded-xl bg-panel px-3 py-2 text-ink">Hi, I’m an AI assistant calling on behalf of Acme.</p>
              <p className="ml-6 rounded-xl bg-panel2 px-3 py-2 text-muted">Sure, go ahead.</p>
            </div>
          </div>
        </Win>
      </Card>

      {/* vPassword */}
      <Card
        title="Secrets they never see"
        body="Logins, cards and saved sessions live in an encrypted vault. Bots use them without ever seeing the values."
      >
        <Win label="vPassword" right="encrypted">
          <div className="space-y-2 p-3 text-sm">
            {[
              ["Salesforce", "••••••••••", "Sales Outbound"],
              ["Gmail", "••••••••••", "Inbox Manager"],
              ["Company card", "•••• ••••", "asks before paying"],
            ].map(([n, v, by]) => (
              <div key={n} className="flex items-center justify-between rounded-xl bg-panel px-4 py-3">
                <div>
                  <p className="text-ink">{n}</p>
                  <p className="text-xs text-muted">{by}</p>
                </div>
                <span className="font-mono text-muted">{v}</span>
              </div>
            ))}
          </div>
        </Win>
      </Card>

      {/* routines */}
      <Card
        title="Routines from one sentence"
        body="Say it once. Your bot sets it up on a schedule, and write actions still wait for your approval."
      >
        <Win label="New routine">
          <div className="space-y-2 p-3 text-sm">
            <p className="rounded-xl bg-panel2 px-4 py-3 text-ink">
              Every Monday at 9, chase overdue invoices and send me a summary.
            </p>
            {[
              ["Schedule", "Mondays at 9:00 AM"],
              ["Task", "Chase overdue invoices"],
              ["Approval", "Before anything is sent"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 rounded-xl bg-panel px-4 py-2.5">
                <Check size={15} className="text-[#3fe08f]" />
                <span className="text-muted">{k}</span>
                <span className="ml-auto text-ink">{v}</span>
              </div>
            ))}
          </div>
        </Win>
      </Card>
    </section>
  );
}