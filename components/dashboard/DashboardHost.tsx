"use client";
// Catches the chat command "[dashboard" BEFORE it is sent to the agent, so it works the same every time:
// the first time it creates this chat's dashboard, later it just says it already exists (one dashboard per chat).
// It needs no change in the chat screen: it listens for the message box being submitted.
import { useEffect } from "react";
import { auth } from "@/lib/firebase";
import { getActiveChat } from "@/lib/avatar-activity";
import { isDashboardCommand } from "@/lib/dashboard-intent";

/** Clears a React-controlled <textarea> the way a person would (so the chat screen's own state is emptied too). */
function clearBox(ta: HTMLTextAreaElement) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  set?.call(ta, "");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

export default function DashboardHost() {
  useEffect(() => {
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      const ta = form.querySelector("textarea");
      if (!ta || !isDashboardCommand(ta.value)) return;
      const chatId = getActiveChat();
      if (!chatId || !location.pathname.startsWith("/dashboard")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const text = ta.value;
      clearBox(ta);
      void (async () => {
        try {
          const token = await auth.currentUser?.getIdToken();
          if (!token) return;
          const res = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ action: "command", chatId, text }) });
          const d = await res.json().catch(() => ({}));
          window.dispatchEvent(new CustomEvent("av:dashboard", { detail: { chatId, created: d?.created === true, error: res.ok ? "" : String(d?.error || "") } }));
        } catch { /* the chat stays as it is */ }
      })();
    };
    // capture phase: runs before the chat screen's own submit handler
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}