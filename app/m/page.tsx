"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ChevronRight, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { useAuth } from "@/lib/auth-context";
import { byRecent, lastActivity, listChats, type Chat } from "@/lib/chats";
import { avatarFor, useAvatarStore } from "@/lib/avatar-activity";
import { useTheme } from "@/lib/theme";
import { isNativeApp } from "@/lib/native";
import { reliability, schedulerStatus } from "@/lib/native-scheduler";

const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim();

function preview(c: Chat): string {
  const m = (Array.isArray(c.messages) ? c.messages : []).slice(-1)[0];
  if (!m) return "Say hi to start";
  const t = plain(String(m.content ?? ""));
  return (m.role === "user" ? "You: " : "") + t;
}

function when(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The home screen of the phone app: your AI teammates, newest chat on top. */
export default function MobileHome() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [todo, setTodo] = useState(0);
  useAvatarStore();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace(isNativeApp() ? "/app-login" : "/"); return; }
    try {
      if (isNativeApp() && !localStorage.getItem("av:welcomed")) { router.replace("/m/welcome"); return; }
    } catch { /* storage blocked: skip the intro */ }
    let dead = false;
    const load = () => listChats(user.uid).then((l) => { if (!dead) { setChats(l); setLoaded(true); setFailed(false); } }).catch(() => { if (!dead) { setLoaded(true); setFailed(true); } });
    void load();
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { dead = true; document.removeEventListener("visibilitychange", onVis); };
  }, [user, loading, router]);

  useEffect(() => {
    if (!isNativeApp()) return;
    const check = () => schedulerStatus().then((s) => setTodo(reliability(s).todo.filter((t) => t !== "autostart").length)).catch(() => undefined);
    void check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  const ordered = useMemo(() => byRecent(chats), [chats]);

  return (
    <main className="mx-auto min-h-screen max-w-md bg-bg px-4 pb-[calc(var(--sab)+24px)] pt-[calc(var(--sat)+12px)] text-ink">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold tracking-tight">AgenticVenus</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Switch Night / Light" className="press flex h-10 w-10 items-center justify-center rounded-full bg-panel2 text-ink">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={() => router.push("/m/computer")} aria-label="Phone computer" className="press flex h-10 w-10 items-center justify-center rounded-full bg-panel2 text-ink">
            <Monitor size={18} />
          </button>
          <button onClick={() => router.push("/m/reliability")} aria-label="Phone schedules" className="press relative flex h-10 w-10 items-center justify-center rounded-full bg-panel2 text-ink">
            <Settings size={18} />
            {todo > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-gold" />}
          </button>
          <button onClick={() => router.push("/dashboard")} aria-label="New bot" className="press flex h-10 w-10 items-center justify-center rounded-full bg-panel2 text-ink">
            <Plus size={20} />
          </button>
        </div>
      </header>

      {todo > 0 && (
        <button onClick={() => router.push("/m/reliability")} className="press mb-4 flex w-full items-center gap-3 rounded-2xl border border-line bg-goldSoft px-4 py-3 text-left">
          <AlarmClock size={20} className="shrink-0 text-gold" />
          <span className="flex-1 text-[13.5px] leading-snug text-ink">Make your schedules run on time: {todo} {todo === 1 ? "thing is" : "things are"} left to switch on.</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
      )}

      {!loaded && <p className="py-16 text-center text-sm text-muted">Loading your bots…</p>}
      {loaded && failed && <p className="py-16 text-center text-sm text-muted">Could not load your bots. Check your internet and open the app again.</p>}

      <ul className="divide-y divide-line/60">
        {ordered.map((c) => (
          <li key={c.id}>
            <button onClick={() => router.push(`/dashboard?chat=${encodeURIComponent(c.id)}`)} className="press flex w-full items-center gap-3.5 py-3 text-left">
              <BotAvatar color={avatarFor(c.id, c.agentColor)} size={52} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[16px] font-semibold">{c.agentName}</span>
                  <span className="shrink-0 text-[12px] text-faint">{when(lastActivity(c))}</span>
                </span>
                <span className="mt-0.5 block truncate text-[14px] text-muted">{preview(c)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {loaded && !failed && (
        <button onClick={() => router.push("/dashboard")} className="press mt-3 flex w-full items-center gap-3.5 py-3 text-left">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-dashed border-faint text-muted"><Plus size={22} /></span>
          <span className="text-[16px] text-muted">New bot</span>
        </button>
      )}
    </main>
  );
}
