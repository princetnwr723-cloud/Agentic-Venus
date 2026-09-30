import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import {
  GONE_PREFIX,
  createSandbox,
  performAction,
  takeScreenshot,
  type PcAction,
} from "@/lib/e2b-server";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

type AgentAction = PcAction & {
  site?: string;
  field?: string;
  question?: string;
  options?: string[];
};

const ALLOWED = new Set([
  "click",
  "double_click",
  "right_click",
  "type",
  "key",
  "scroll",
  "wait",
  "done",
  "need_login",
  "type_secret",
  "ask_user",
]);

function systemPrompt(width: number, height: number) {
  return `You are an AI agent operating a Linux desktop (a web browser is available, VS Code may be installed) by looking at screenshots. The screenshot is ${width}x${height} pixels; give coordinates in that pixel space, with (0,0) at the top-left.

Reply with ONE JSON object only — no prose, no markdown fences:
{"thought": "<one short sentence>", "action": {...}}

Actions:
{"type":"click","x":N,"y":N}
{"type":"double_click","x":N,"y":N}
{"type":"right_click","x":N,"y":N}
{"type":"type","text":"..."}
{"type":"key","keys":"Return"}   (or a combo like "ctrl+l")
{"type":"scroll","x":N,"y":N,"direction":"down","amount":3}
{"type":"wait","seconds":2}
{"type":"need_login","site":"Gmail"}   (ask the user for email + password for a site)
{"type":"type_secret","field":"email"}   (types the saved email/username; field is "email" or "password")
{"type":"ask_user","question":"...","options":["A","B"]}   (options optional; without options the user types a free-text answer, e.g. an OTP or verification code)
{"type":"done","summary":"what you actually accomplished"}

Rules:
- Click a text field before typing into it; one action per reply; if a page is still loading, wait.
- NEVER guess or invent credentials. When a site needs a login and you don't have credentials yet, use need_login ONCE. After the user provides them, click the email field and use type_secret with field "email", then click the password field and use type_secret with field "password", then submit.
- If a login page offers several ways to sign in (for example Google, Apple, email), use ask_user with those choices so the user picks.
- For OTPs, verification codes, captchas you cannot solve, or any decision that belongs to the user, use ask_user. Then type the answer they give.
- When the task is finished — or truly impossible — reply with "done" and an honest summary (include key findings if it was a research task).`;
}

function parseStep(text: string): { thought: string; action: AgentAction } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      thought?: string;
      action?: AgentAction;
    };
    if (!parsed.action || !ALLOWED.has(parsed.action.type)) return null;
    return { thought: parsed.thought ?? "", action: parsed.action };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      e2bKey,
      sandboxId,
      provider,
      apiKey,
      model,
      task,
      history,
      creds,
    }: {
      e2bKey: string;
      sandboxId: string;
      provider: ProviderId;
      apiKey: string;
      model: string;
      task: string;
      history: string[];
      creds?: { email?: string; password?: string };
    } = body;

    if (!e2bKey || !sandboxId || !apiKey || !provider || !model || !task) {
      return NextResponse.json({ error: "Missing something needed to run a step." }, { status: 400 });
    }

    // Connecting wakes a paused computer and extends its 1-hour timer.
    // If the computer is truly gone, start a fresh one and let the browser
    // continue the task on it.
    let shot;
    try {
      shot = await takeScreenshot(e2bKey, sandboxId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.startsWith(GONE_PREFIX)) {
        const newSandboxId = await createSandbox(e2bKey);
        return NextResponse.json({
          done: false,
          thought: "",
          actionText:
            "The computer had expired, so a fresh one was started (files from the old one are gone).",
          newSandboxId,
        });
      }
      throw err;
    }

    const reply = await callProvider({
      provider,
      apiKey,
      model,
      messages: [
        { role: "system", content: systemPrompt(shot.width, shot.height) },
        {
          role: "user",
          content: `Task: ${task}\n\nSteps so far:\n${
            history && history.length > 0 ? history.join("\n") : "(none yet)"
          }\n\nHere is the current screen. What is the next action?`,
          image: { mediaType: shot.mediaType, data: shot.data },
        },
      ],
    });

    const step = parseStep(reply);
    if (!step) {
      // Soft failure: let the loop try again instead of aborting the task.
      return NextResponse.json({
        done: false,
        thought: "",
        actionText: "(the model's reply wasn't a valid action — retrying)",
      });
    }
    const { thought, action } = step;

    if (action.type === "done") {
      return NextResponse.json({ done: true, thought, summary: action.summary ?? "Done." });
    }

    if (action.type === "need_login") {
      return NextResponse.json({
        done: false,
        thought,
        ask: { kind: "login", site: action.site ?? "" },
      });
    }

    if (action.type === "ask_user") {
      const options = Array.isArray(action.options)
        ? action.options.filter((o) => typeof o === "string" && o.trim()).slice(0, 8)
        : [];
      return NextResponse.json({
        done: false,
        thought,
        ask: {
          kind: options.length > 0 ? "choice" : "text",
          question: action.question ?? "The agent needs your input.",
          options,
        },
      });
    }

    if (typeof action.x === "number") action.x = Math.min(Math.max(action.x, 0), shot.width - 1);
    if (typeof action.y === "number") action.y = Math.min(Math.max(action.y, 0), shot.height - 1);

    let actionText: string;
    try {
      if (action.type === "type_secret") {
        const field = action.field === "password" ? "password" : "email";
        const value = field === "password" ? creds?.password : creds?.email;
        if (!value) {
          actionText = `FAILED type_secret: no ${field} available — use need_login first.`;
        } else {
          await performAction(e2bKey, sandboxId, { type: "type", text: value });
          // The real value is never returned or logged.
          actionText = `typed saved ${field} (hidden)`;
        }
      } else {
        actionText = await performAction(e2bKey, sandboxId, action);
      }
    } catch (err) {
      actionText = `FAILED ${action.type}: ${err instanceof Error ? err.message : "unknown error"}`;
    }

    await new Promise((r) => setTimeout(r, 1200));

    return NextResponse.json({ done: false, thought, actionText });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Step failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}