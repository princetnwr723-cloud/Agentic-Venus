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
  "open_url",
  "search",
  "note",
  "done",
  "need_login",
  "type_secret",
  "ask_user",
]);

function systemPrompt(width: number, height: number, maxSteps: number) {
  return `You are an AI agent that operates a Linux desktop (with a web browser) by looking at screenshots. The screenshot is ${width}x${height} pixels. All coordinates are ABSOLUTE PIXELS in that space, with (0,0) at the top-left. Never use normalized values (0-1 or 0-1000).

Reply with ONE JSON object only — no prose, no markdown fences:
{"observation":"<what is on the screen right now, and does it match the goal?>","thought":"<your next step and why, one sentence>","action":{...}}

PREFERRED ACTIONS (fast and reliable — use these instead of clicking around):
{"type":"search","query":"latest AI news today"}      opens a web search in the browser
{"type":"open_url","url":"https://example.com"}       opens that page in the browser
{"type":"note","text":"short fact you found + source"} saves a finding so you don't forget it

OTHER ACTIONS:
{"type":"click","x":N,"y":N}
{"type":"double_click","x":N,"y":N}
{"type":"right_click","x":N,"y":N}
{"type":"type","text":"..."}
{"type":"key","keys":"Return"}   (or a combo like "ctrl+l", "alt+Left", "ctrl+w")
{"type":"scroll","x":N,"y":N,"direction":"down","amount":3}
{"type":"wait","seconds":2}
{"type":"need_login","site":"Gmail"}     ask the user for email + password for a site
{"type":"type_secret","field":"email"}   types the saved email/username (field is "email" or "password")
{"type":"ask_user","question":"...","options":["A","B"]}   options optional; without options the user types a free-text answer (e.g. an OTP)
{"type":"done","summary":"what you actually accomplished, including the real findings"}

RULES
1. Stay strictly on the user's task. NEVER open YouTube, social feeds, ads, shopping pages or recommended videos unless the task explicitly asks for them.
2. For any research / "find", "look up", "news" task: your FIRST action is "search" with a good query (add words like "today" or the current year when the user wants the latest). Then open the 2-4 most relevant NON-ad results (click a result title or use open_url), read them, and use "note" to save key facts with the source name. Finish with "done" once you have enough — the summary must contain the actual findings, not just "done".
3. Look carefully at the screenshot before every action. If the screen is not what you expected, fix that first (close popups and cookie banners, go back with "alt+Left").
4. Click a text field before typing into it. One action per reply. If a page is still loading, wait 2 seconds.
5. Never repeat the same action more than twice — if it didn't work, change approach (use search/open_url or a keyboard shortcut).
6. NEVER guess or invent credentials. If a site needs a login and you don't have credentials yet, use need_login ONCE. After the user provides them: click the email field and use type_secret with field "email", then click the password field and use type_secret with field "password", then submit.
7. If a login page offers several ways to sign in (Google, Apple, email…), use ask_user with those choices so the user picks.
8. For OTPs, verification codes, captchas you cannot solve, or any decision that belongs to the user, use ask_user, then type the answer they give.
9. You have at most ${maxSteps} actions, so be efficient. When the task is finished — or truly impossible — reply with "done" and an honest summary.`;
}

function parseStep(text: string): { thought: string; action: AgentAction } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      observation?: string;
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
      notes,
      hint,
      stepNo,
      maxSteps,
      creds,
    }: {
      e2bKey: string;
      sandboxId: string;
      provider: ProviderId;
      apiKey: string;
      model: string;
      task: string;
      history: string[];
      notes?: string[];
      hint?: string;
      stepNo?: number;
      maxSteps?: number;
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

    const limit = maxSteps ?? 40;
    const current = stepNo ?? 1;
    const budgetHint =
      current >= limit - 3
        ? "You are almost out of steps — wrap up NOW with done and a summary of what you found."
        : "";

    const reply = await callProvider({
      provider,
      apiKey,
      model,
      messages: [
        { role: "system", content: systemPrompt(shot.width, shot.height, limit) },
        {
          role: "user",
          content: [
            `Task: ${task}`,
            `Action ${current} of ${limit}.`,
            `Notes saved so far:\n${notes && notes.length > 0 ? notes.map((n) => `- ${n}`).join("\n") : "(none)"}`,
            `Steps so far:\n${history && history.length > 0 ? history.join("\n") : "(none yet)"}`,
            hint ? `IMPORTANT: ${hint}` : "",
            budgetHint ? `IMPORTANT: ${budgetHint}` : "",
            "Here is the current screen. Reply with the JSON for the next action.",
          ]
            .filter(Boolean)
            .join("\n\n"),
          image: { mediaType: shot.mediaType, data: shot.data },
        },
      ],
    });

    const step = parseStep(reply);
    if (!step) {
      // Soft failure: let the loop try again instead of aborting the task.
      return NextResponse.json({
        done: false,
        invalid: true,
        thought: "",
        actionText: "(the model's reply wasn't a valid action — retrying)",
      });
    }
    const { thought, action } = step;

    if (action.type === "done") {
      return NextResponse.json({ done: true, thought, summary: action.summary ?? "Done." });
    }

    if (action.type === "note") {
      const text = (action.text ?? "").trim().slice(0, 500);
      return NextResponse.json({
        done: false,
        thought,
        actionText: `noted: ${text.slice(0, 90)}`,
        note: text,
      });
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

    // Some models answer in 0-1 fractions instead of pixels — convert those.
    if (
      typeof action.x === "number" &&
      typeof action.y === "number" &&
      action.x <= 1 &&
      action.y <= 1 &&
      (!Number.isInteger(action.x) || !Number.isInteger(action.y))
    ) {
      action.x = action.x * shot.width;
      action.y = action.y * shot.height;
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