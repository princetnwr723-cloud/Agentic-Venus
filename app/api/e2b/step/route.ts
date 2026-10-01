import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import {
  GONE_PREFIX,
  createSandbox,
  performAction,
  shellCheck,
  shellStart,
  takeScreenshot,
  type PcAction,
  type ShellResult,
} from "@/lib/e2b-server";
import { webRead, webSearch } from "@/lib/web-tools-server";
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
  "click", "double_click", "right_click", "type", "key", "scroll", "wait",
  "open_url", "launch", "search", "shell", "shell_check", "web_search", "web_read",
  "note", "done", "need_login", "type_secret", "ask_user",
]);

function systemPrompt(width: number, height: number, maxSteps: number) {
  return `You are an AI agent that operates a Linux computer for the user. You can see its screen (screenshot ${width}x${height} px; coordinates are ABSOLUTE PIXELS, (0,0) top-left — never 0-1 or 0-1000 values) and you can run shell commands and read web pages directly. The computer is ALREADY ON — ignore any part of the task that only says to turn it on.

Reply with ONE JSON object only — no prose, no markdown fences:
{"observation":"<what you see / what the last output said, and does it match the goal?>","thought":"<your next step and why, one sentence>","action":{...}}

TOOLS (prefer these — they are the fastest and most reliable):
{"type":"shell","command":"..."}          run a command in a real terminal window on the screen; you get its output back
{"type":"shell_check","job":"j123"}       wait for a command that was still running
{"type":"web_search","query":"..."}       search the web; you get titles, links and snippets as text
{"type":"web_read","url":"https://..."}   read a web page as plain text
{"type":"search","query":"..."}           show a web search in the browser on screen
{"type":"open_url","url":"https://..."}   show a page in the browser on screen
{"type":"launch","app":"chrome"}          open an app on the screen (chrome, firefox, terminal, code, files)
{"type":"note","text":"..."}              save a short finding or progress marker (kept for the whole task)

SCREEN ACTIONS (only when you really need the GUI):
{"type":"click","x":N,"y":N}  {"type":"double_click","x":N,"y":N}  {"type":"right_click","x":N,"y":N}
{"type":"type","text":"..."}
{"type":"key","keys":"Return"}   (or a combo like "ctrl+l", "alt+Left")
{"type":"scroll","x":N,"y":N,"direction":"down","amount":3}
{"type":"wait","seconds":2}

ASKING THE USER:
{"type":"need_login","site":"Gmail"}     ask for email + password for a site
{"type":"type_secret","field":"email"}   types the saved email/username (field: "email" or "password")
{"type":"ask_user","question":"...","options":["A","B"]}   options optional; without them the user types free text (e.g. an OTP)

FINISHING:
{"type":"done","summary":"..."}

RULES
1. Do ALL parts of the task, in order. If the task has several parts, keep a checklist in your notes ("1/3 done"). Never call done while a part is still pending. In the done summary, state for every part whether it is done (✓) or not (✗) and why.
2. Terminal work: "shell" opens a REAL terminal window on the screen and runs the command there while the user watches live — use it for EVERY terminal task (installing software, files, git, scripts, versions), and always when the user says "terminal" or "command". Commands run as a normal user with passwordless sudo. Make them non-interactive: -y flags, DEBIAN_FRONTEND=noninteractive, curl -fsSL. After installing something, verify it. To install Claude Code use the official installer: "curl -fsSL https://claude.ai/install.sh | bash", then verify with "export PATH=$HOME/.local/bin:$PATH; claude --version". If that fails, install Node.js 20 ("curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs") and run "npm install -g @anthropic-ai/claude-code" (global npm installs go to ~/.npm-global, no sudo needed). Do not try to sign in to Claude Code yourself: report that it is installed and tell the user to run "claude" and sign in. apt-get waits for package locks automatically (another installer may be running for a few minutes), so be patient and use shell_check.
3. If a shell result says STILL RUNNING, call shell_check with that job id until it finishes. NEVER start the same command again while its job is running. If a command fails, read the error, fix the cause, and retry — do not give up after one failure.
4. Research ("find", "look up", "news"): use web_search first, then web_read on the 2-4 best NON-ad results, and use note to save key facts with the source name. If web_search fails, retry ONCE with a shorter, different query; if it still fails, use web_read on a page you know (Wikipedia, the official site, socialblade.com for YouTube stats, etc.) or use search/open_url in the browser and read the screen. Use the browser also when the user wants to see it.
5. Stay strictly on the task. NEVER open YouTube, social feeds, ads, shopping pages or recommended videos unless the task says so.
6. Look at the screenshot before screen actions. If the screen is not what you expected, fix that first (close popups, go back with "alt+Left"). Click a text field before typing. One action per reply.
7. Never repeat the same action more than twice — change approach instead.
8. NEVER guess or invent credentials. If a site needs a login and you have none, use need_login ONCE; after the user provides them, click the email field and use type_secret "email", click the password field and use type_secret "password", then submit. If a login page offers several sign-in methods, use ask_user with those choices. For OTPs, verification codes, or decisions that belong to the user, use ask_user.
9. You have at most ${maxSteps} actions. Be efficient. The "summary" in done must contain the real results (findings, versions, paths) — not just "done".
10. Approvals: before any irreversible or outward-facing action (sending an email or message, posting publicly, buying, deleting data, changing account settings), ask with ask_user and options ["Approve","Cancel"], and do it only after "Approve".`;
}

function parseStep(text: string): { thought: string; action: AgentAction } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { thought?: string; action?: AgentAction };
    if (!parsed.action || !ALLOWED.has(parsed.action.type)) return null;
    return { thought: parsed.thought ?? "", action: parsed.action };
  } catch {
    return null;
  }
}

function formatShell(r: ShellResult): string {
  const head = r.done
    ? `exit code: ${r.exitCode}`
    : `STILL RUNNING (job id ${r.jobId}). Call shell_check with this job id to wait for it.`;
  return `${head}\n${r.output || "(no output yet)"}`.slice(0, 3800);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      e2bKey, sandboxId, provider, apiKey, model, task, history, notes, hint,
      stepNo, maxSteps, lastOutput, runningJob, creds,
    }: {
      e2bKey: string; sandboxId: string; provider: ProviderId; apiKey: string; model: string;
      task: string; history: string[]; notes?: string[]; hint?: string; stepNo?: number;
      maxSteps?: number; lastOutput?: string; runningJob?: { id: string; command: string };
      creds?: { email?: string; password?: string };
    } = body;

    if (!e2bKey || !sandboxId || !apiKey || !provider || !model || !task) {
      return NextResponse.json({ error: "Missing something needed to run a step." }, { status: 400 });
    }

    let shot;
    try {
      shot = await takeScreenshot(e2bKey, sandboxId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.startsWith(GONE_PREFIX)) {
        const created = await createSandbox(e2bKey);
        return NextResponse.json({
          done: false,
          thought: "",
          actionText: "The computer had expired, so a fresh one was started (files from the old one are gone).",
          newSandboxId: created.sandboxId,
        });
      }
      throw err;
    }

    const limit = maxSteps ?? 50;
    const current = stepNo ?? 1;
    const budgetHint =
      current >= limit - 3
        ? "You are almost out of steps — wrap up NOW with done and a summary of what you achieved."
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
            runningJob
              ? `A command is STILL RUNNING: job ${runningJob.id} (${runningJob.command.slice(0, 100)}). Do NOT start it again — call shell_check with this job id.`
              : "",
            lastOutput ? `Output of your previous action:\n${lastOutput}` : "",
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
      return NextResponse.json({
        done: false,
        invalid: true,
        thought: "",
        actionText: "(the model's reply wasn't a valid action — retrying)",
      });
    }
    const { thought, action } = step;

    // The model tried to start a command that is already running: just wait for it.
    if (action.type === "shell" && runningJob && norm(action.command ?? "") === norm(runningJob.command)) {
      action.type = "shell_check";
      action.job = runningJob.id;
    }

    if (action.type === "done") {
      return NextResponse.json({ done: true, thought, summary: action.summary ?? "Done." });
    }

    if (action.type === "note") {
      const text = (action.text ?? "").trim().slice(0, 500);
      return NextResponse.json({ done: false, thought, actionText: `noted: ${text.slice(0, 90)}`, note: text });
    }

    if (action.type === "shell" || action.type === "shell_check") {
      try {
        const isStart = action.type === "shell";
        const r = isStart
          ? await shellStart(e2bKey, sandboxId, (action.command ?? "").trim())
          : await shellCheck(e2bKey, sandboxId, (action.job ?? "").trim());
        const command = isStart ? (action.command ?? "").trim() : runningJob?.command ?? "";
        const label = isStart ? `$ ${command.slice(0, 90)}` : `check ${action.job}`;
        return NextResponse.json({
          done: false,
          thought,
          actionText: `${label} → ${r.done ? `exit ${r.exitCode}` : `still running (${r.jobId})`}`,
          output: formatShell(r),
          job: { id: r.jobId, done: r.done, command },
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : "shell failed";
        if (m.startsWith(GONE_PREFIX)) throw err;
        return NextResponse.json({
          done: false,
          thought,
          actionText: `FAILED ${action.type}: ${m}`,
          output: `ERROR: ${m}`,
        });
      }
    }

    if (action.type === "web_search" || action.type === "web_read") {
      try {
        const text =
          action.type === "web_search"
            ? await webSearch((action.query ?? "").trim())
            : await webRead((action.url ?? "").trim());
        return NextResponse.json({
          done: false,
          thought,
          actionText:
            action.type === "web_search"
              ? `web search "${(action.query ?? "").slice(0, 70)}"`
              : `read ${(action.url ?? "").slice(0, 80)}`,
          output: text.slice(0, 4500),
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : "failed";
        return NextResponse.json({
          done: false,
          thought,
          actionText: `FAILED ${action.type}: ${m}`,
          output: `ERROR: ${m} — try another source, or use search/open_url in the browser.`,
        });
      }
    }

    if (action.type === "need_login") {
      return NextResponse.json({ done: false, thought, ask: { kind: "login", site: action.site ?? "" } });
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

    if (
      typeof action.x === "number" && typeof action.y === "number" &&
      action.x <= 1 && action.y <= 1 &&
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