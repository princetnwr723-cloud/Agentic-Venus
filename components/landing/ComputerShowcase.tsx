"use client";

import { Calendar, Folder, Globe, Home, Mail, SlidersHorizontal, Terminal, Trash2, FileText } from "lucide-react";

const MAILS = [
  { who: "Brightwave", sub: "Invoice #2031 · $1,840", tag: "Reminder sent", state: "done" },
  { who: "Kestrel Labs", sub: "Invoice #2034 · $620", tag: "Reminder sent", state: "done" },
  { who: "Orbit Foods", sub: "Invoice #2040 · $3,150", tag: "6 days overdue", state: "active" },
  { who: "Pinecrest", sub: "Invoice #2044 · $390", tag: "3 days overdue", state: "late" },
];

export default function ComputerShowcase() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="text-center">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight text-ink md:text-6xl">
          Work with a whole team of bots
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
          Give each bot a job, a brain and a computer. They work in parallel in the cloud and come
          back when something needs you.
        </p>
      </div>

      <div className="mt-14 grid items-center gap-10 rounded-xl2 border border-line bg-panel/50 p-6 md:grid-cols-[0.8fr_1.4fr] md:p-10">
        <div>
          <h3 className="text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl">
            Every bot gets a computer
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            A private Linux desktop with Chrome, a terminal and office tools. Watch the screen live,
            or take control any time.
          </p>
        </div>

        {/* desktop */}
        <div className="rounded-[1.6rem] border border-line bg-bg p-2.5">
          <div className="relative h-[420px] overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d4a36] via-[#0b3a2c] to-[#082a21]">
            {/* top bar */}
            <div className="flex items-center justify-between bg-black/40 px-4 py-1.5 text-xs text-white/80">
              <span>Activities</span>
              <span>Fri 9:41</span>
              <span className="flex items-center gap-1.5">
                <span className="lv-dot-live h-1.5 w-1.5 rounded-full bg-[#3fe08f]" />
                Expense Manager · Live
              </span>
            </div>

            {/* mail window */}
            <div className="absolute left-4 right-4 top-12 overflow-hidden rounded-xl border border-white/10 bg-[#101012] shadow-2xl md:right-28">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-white/70">
                <span className="w-10" />
                <span>Inbox — Mail</span>
                <span className="flex gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <i className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <i className="h-2.5 w-2.5 rounded-full bg-[#d6454d]" />
                </span>
              </div>
              <div className="grid grid-cols-[96px_1fr] sm:grid-cols-[110px_190px_1fr]">
                <div className="space-y-1 border-r border-white/10 p-2 text-xs text-white/60">
                  <p className="rounded bg-white/10 px-2 py-1 text-white">Inbox</p>
                  <p className="px-2 py-1">Flagged</p>
                  <p className="px-2 py-1">Sent</p>
                  <p className="px-2 py-1">Drafts</p>
                  <p className="px-2 pt-3 text-[10px] tracking-wider text-white/35">FOLDERS</p>
                  <p className="px-2 py-1">Invoices</p>
                </div>
                <div className="hidden border-r border-white/10 sm:block">
                  {MAILS.map((m) => (
                    <div
                      key={m.who}
                      className={`border-b border-white/5 px-3 py-2 text-xs ${
                        m.state === "active" ? "bg-[#2f6fed] text-white" : "text-white/70"
                      }`}
                    >
                      <p className="font-medium text-white">{m.who}</p>
                      <p>{m.sub}</p>
                      <p
                        className={
                          m.state === "done"
                            ? "text-[#3fe08f]"
                            : m.state === "late"
                            ? "text-[#ff6b6b]"
                            : "text-white"
                        }
                      >
                        {m.state === "done" ? "✓ " : ""}
                        {m.tag}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="relative p-4 text-xs text-white/75">
                  <p className="text-sm font-semibold text-white">Invoice #2040 · $3,150</p>
                  <p className="mt-1 text-white/50">Orbit Foods Billing → you</p>
                  <p className="mt-3 text-white/60">The invoice was due 6 days ago. The PDF is attached.</p>
                  <div className="relative mt-4 rounded-lg border border-[#2f6fed] bg-black/40 p-3 leading-relaxed text-white/90">
                    Hi Orbit team, a friendly nudge on invoice #2040 for $3,150, now 6 days overdue.
                    Could you let me know when to expect payment?
                    <span className="lv-caret ml-0.5 inline-block h-3 w-px bg-white align-middle" />
                    <span className="lv-cursor absolute -bottom-4 right-6 flex items-center gap-1">
                      <span className="h-0 w-0 -rotate-12 border-x-[6px] border-b-[12px] border-x-transparent border-b-[#ef8a2f]" />
                      <span className="rounded-full bg-[#ef8a2f] px-2 py-0.5 text-[10px] font-medium text-black">
                        Expense Manager
                      </span>
                    </span>
                  </div>
                  <span className="mt-6 inline-block rounded-lg bg-[#2f6fed] px-4 py-1.5 font-medium text-white">
                    Send
                  </span>
                </div>
              </div>
            </div>

            {/* terminal */}
            <div className="absolute bottom-16 right-28 hidden w-60 rounded-lg border border-white/10 bg-[#07100c]/95 p-3 font-mono text-[11px] leading-5 text-white/70 shadow-xl lg:block">
              <p className="text-white/40">cloud: ~</p>
              <p>$ chase-invoices</p>
              <p className="text-[#3fe08f]">✓ found 4 overdue invoices</p>
              <p className="text-[#3fe08f]">✓ reminder sent to Brightwave</p>
              <p className="text-[#3fe08f]">✓ reminder sent to Kestrel Labs</p>
            </div>

            {/* desktop icons */}
            <div className="absolute right-4 top-12 hidden flex-col gap-4 text-center text-[10px] text-white/80 md:flex">
              {[
                { i: <Home size={20} />, l: "Home" },
                { i: <FileText size={20} />, l: "invoices.csv" },
                { i: <Trash2 size={20} />, l: "Trash" },
              ].map((x) => (
                <div key={x.l} className="flex flex-col items-center gap-1">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">{x.i}</span>
                  {x.l}
                </div>
              ))}
            </div>

            {/* dock */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-white/80">
              {[Folder, Mail, Globe, Terminal, Calendar, SlidersHorizontal].map((Icon, i) => (
                <span
                  key={i}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${i === 1 ? "bg-white/15" : ""}`}
                >
                  <Icon size={18} />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}