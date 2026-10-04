import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import {
  GONE_PREFIX, createSandbox, performAction, shellCheck, shellStart, takeScreenshot,
  type PcAction, type ShellResult,
} from "@/lib/e2b-server";
import { webRead, webSearch } from "@/lib/web-tools-server";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

type AgentAction = PcAction & { site?: string; field?: string; question?: string; options?: string[]; instruction?: string; ops?: unknown[] };

const ALLOWED = new Set([
  "click", "double_click", "right_click", "type", "key", "scroll", "wait",
  "open_url", "launch", "search", "shell", "shell_check", "web_search", "web_read", "browse", "code",
  "note", "done", "need_login", "type_secret", "ask_user",
]);

function systemPrompt(width: number, height: number, maxSteps: number, context: string) {
  return `You are an AI agent that works on a Linux computer the way a capable person would: you pick the right tool for each job. You can see the screen (screenshot ${width}x${height} px; coordinates are ABSOLUTE PIXELS, (0,0) top-left — never 0-1 or 0-1000 values). The computer is ALREADY ON — ignore any part of the task that only says to turn it on.

Reply with ONE JSON object only — no prose, no markdown fences:
{"observation":"<what you see / what the last output said, and does it match the goal?>","thought":"<your next step and why, one sentence>","action":{...}}

TOOLS
{"type":"web_search","query":"..."}       search the web; returns titles, links, snippets as text
{"type":"web_read","url":"https://..."}   read a web page as plain text
{"type":"browse","url":"https://...","ops":[{"op":"click","id":5},{"op":"type","id":3,"text":"..."},{"op":"secret","id":3,"field":"email"},{"op":"press","key":"Enter"},{"op":"scroll","dir":"down"}]}   FAST DOM browser: returns a NUMBERED list of the page's buttons/links/inputs; you act by number. Omit "url" to stay on the current page.
{"type":"search","query":"..."}           show a web search in the browser on screen
{"type":"open_url","url":"https://..."}   show a page in the browser on screen
{"type":"launch","app":"chrome"}          open an app on the screen (chrome, firefox, terminal, code, files)
{"type":"shell","command":"..."}          run a command in a real terminal window on the screen (the user watches)
{"type":"shell_check","job":"j123"}       wait for a command that was still running
{"type":"code","instruction":"..."}       hand a coding job to Venus Code, a full coding agent (see rule 3)
{"type":"note","text":"..."}              save a short finding or progress marker (kept for the whole task)
Screen actions (only when the GUI is really needed):
{"type":"click","x":N,"y":N}  {"type":"double_click","x":N,"y":N}  {"type":"right_click","x":N,"y":N}
{"type":"type","text":"..."}  {"type":"key","keys":"Return"} (or "ctrl+l", "alt+Left")
{"type":"scroll","x":N,"y":N,"direction":"down","amount":3}  {"type":"wait","seconds":2}
Asking the user:
{"type":"need_login","site":"Gmail"}  {"type":"type_secret","field":"email"|"password"}
{"type":"ask_user","question":"...","options":["A","B"]}
Finishing: {"type":"done","summary":"..."}

RULES
1. CHOOSE THE TOOL LIKE A PERSON WOULD:
   - Reading/researching the web → web_search then web_read (fast text). Use the real browser (launch chrome / open_url + screen actions) only when the job needs it: logging in, forms, JavaScript-heavy pages, things the user wants to see.
   - Terminal work (install, run, files, git, scripts, system info) → shell. Do NOT use shell to fetch web pages when web_read works.
   - Building or changing software, websites, apps → code (rule 3). Never hand-write project files through the terminal.
   - Other apps and GUIs → screen actions.
   Never open a terminal for something a web page answers, and never open the browser for something a one-line command does.
1b. For ANY website interaction (forms, logins, clicking, reading a page that needs JavaScript) use "browse" first — numbers are far more accurate than pixel clicks. The page is reloaded on every browse call, so do a whole form in ONE call (type, type, click). If a click changes the page, you get the new page back. For logins: after need_login use op "secret" with field "email"/"password". Use the screen browser (open_url + clicks) only when the user wants to watch, or browse fails (captcha, blocked).
2. You may be given ONE STEP of a larger plan. Work ONLY on the current step and call done as soon as it is complete, with a summary of the actual result.
3. {"type":"code","instruction":"..."}: write a complete, self-contained instruction (what to build/change, constraints, where). It returns a summary of what was done. Use it for any coding task.
4. Terminal specifics: commands run as a normal user with passwordless sudo; make them non-interactive (-y, DEBIAN_FRONTEND=noninteractive, curl -fsSL); verify installs. Claude Code: "curl -fsSL https://claude.ai/install.sh | bash" then "export PATH=$HOME/.local/bin:$PATH; claude --version" (fallback: Node 20 + "npm install -g @anthropic-ai/claude-code"); never sign in for the user. apt waits for locks automatically, so be patient. If a result says STILL RUNNING use shell_check — NEVER start the same command again.
5. If a tool fails, read the error, fix the cause and retry; try another tool before giving up. If web_search fails, retry once with a different query, then use web_read on a known page or the browser.
6. Stay strictly on the task. Never open YouTube, social feeds, ads or shopping unless the task says so. Look at the screenshot before screen actions; click a field before typing; one action per reply; never repeat the same action more than twice.
7. NEVER invent credentials. If a site needs a login and you have none, use need_login ONCE; then click the email field and type_secret "email", click the password field and type_secret "password", submit. For OTPs, captchas and sign-in method choices use ask_user.
8. Approvals: before any irreversible or outward-facing action (sending email/messages, posting, buying, deleting data, changing account settings) ask with ask_user and options ["Approve","Cancel"]; proceed only after "Approve".
9. You have at most ${maxSteps} actions. The "summary" in done must contain the real results (findings, versions, paths) — not just "done".${context}`;
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
  const head = r.done ? `exit code: ${r.exitCode}` : `STILL RUNNING (job id ${r.jobId}). Call shell_check with this job id to wait for it.`;
  return `${head}\n${r.output || "(no output yet)"}`.slice(0, 3800);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      e2bKey, sandboxId, provider, apiKey, model, task, history, notes, hint, stepNo, maxSteps,
      lastOutput, runningJob, context, creds,
    }: {
      e2bKey: string; sandboxId: string; provider: ProviderId; apiKey: string; model: string; task: string;
      history: string[]; notes?: string[]; hint?: string; stepNo?: number; maxSteps?: number; lastOutput?: string;
      runningJob?: { id: string; command: string }; context?: string; creds?: { email?: string; password?: string };
    } = body;

    if (!e2bKey || !sandboxId || !apiKey || !provider || !model || !task) {
      return NextResponse.json({ error: "Missing something needed to run a step." }, { status: 400 });
    }

    let shot;
    try {
      shot = await takeScreenshot(e2bKey, sandboxId);
    } catch (err) {
      if ((err instanceof Error ? err.message : "").startsWith(GONE_PREFIX)) {
        const created = await createSandbox(e2bKey);
        return NextResponse.json({
          done: false, thought: "",
          actionText: "The computer had expired, so a fresh one was started (files from the old one are gone).",
          newSandboxId: created.sandboxId,
        });
      }
      throw err;
    }

    const limit = maxSteps ?? 25;
    const current = stepNo ?? 1;
    const budgetHint = current >= limit - 3 ? "You are almost out of steps — wrap up NOW with done and a summary of what you achieved." : "";

    const reply = await callProvider({
      provider, apiKey, model,
      messages: [
        { role: "system", content: systemPrompt(shot.width, shot.height, limit, context ? `\n\n${context.slice(0, 9000)}` : "") },
        {
          role: "user",
          content: [
            `Task: ${task}`,
            `Action ${current} of ${limit}.`,
            `Notes saved so far:\n${notes && notes.length > 0 ? notes.map((n) => `- ${n}`).join("\n") : "(none)"}`,
            `Steps so far:\n${history && history.length > 0 ? history.join("\n") : "(none yet)"}`,
            runningJob ? `A command is STILL RUNNING: job ${runningJob.id} (${runningJob.command.slice(0, 100)}). Do NOT start it again — call shell_check with this job id.` : "",
            lastOutput ? `Output of your previous action:\n${lastOutput}` : "",
            hint ? `IMPORTANT: ${hint}` : "",
            budgetHint ? `IMPORTANT: ${budgetHint}` : "",
            "Here is the current screen. Reply with the JSON for the next action.",
          ].filter(Boolean).join("\n\n"),
          image: { mediaType: shot.mediaType, data: shot.data },
        },
      ],
    });

    const step = parseStep(reply);
    if (!step) {
      return NextResponse.json({ done: false, invalid: true, thought: "", actionText: "(the model's reply wasn't a valid action — retrying)" });
    }
    const { thought, action } = step;

    if (action.type === "shell" && runningJob && norm(action.command ?? "") === norm(runningJob.command)) {
      action.type = "shell_check";
      action.job = runningJob.id;
    }

    if (action.type === "done") return NextResponse.json({ done: true, thought, summary: action.summary ?? "Done." });

    if (action.type === "note") {
      const text = (action.text ?? "").trim().slice(0, 500);
      return NextResponse.json({ done: false, thought, actionText: `noted: ${text.slice(0, 90)}`, note: text });
    }

    if (action.type === "code") {
      const instruction = (action.instruction ?? "").trim().slice(0, 4000);
      if (!instruction) return NextResponse.json({ done: false, thought, actionText: "FAILED code: no instruction", output: "ERROR: the code action needs an instruction." });
      return NextResponse.json({ done: false, thought, actionText: `code: ${instruction.slice(0, 90)}`, delegate: { kind: "code", instruction } });
    }

    if (action.type === "shell" || action.type === "shell_check") {
      try {
        const isStart = action.type === "shell";
        const r = isStart
          ? await shellStart(e2bKey, sandboxId, (action.command ?? "").trim())
          : await shellCheck(e2bKey, sandboxId, (action.job ?? "").trim());
        const command = isStart ? (action.command ?? "").trim() : runningJob?.command ?? "";
        return NextResponse.json({
          done: false, thought,
          actionText: `${isStart ? `$ ${command.slice(0, 90)}` : `check ${action.job}`} → ${r.done ? `exit ${r.exitCode}` : `still running (${r.jobId})`}`,
          output: formatShell(r),
          job: { id: r.jobId, done: r.done, command },
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : "shell failed";
        if (m.startsWith(GONE_PREFIX)) throw err;
        return NextResponse.json({ done: false, thought, actionText: `FAILED ${action.type}: ${m}`, output: `ERROR: ${m}` });
      }
    }

    if (action.type === "web_search" || action.type === "web_read") {
      try {
        const text = action.type === "web_search" ? await webSearch((action.query ?? "").trim()) : await webRead((action.url ?? "").trim());
        return NextResponse.json({
          done: false, thought,
          actionText: action.type === "web_search" ? `web search "${(action.query ?? "").slice(0, 70)}"` : `read ${(action.url ?? "").slice(0, 80)}`,
          output: text.slice(0, 4500),
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : "failed";
        return NextResponse.json({ done: false, thought, actionText: `FAILED ${action.type}: ${m}`, output: `ERROR: ${m} — try another source, or use search/open_url in the browser.` });
      }
    }

    if (action.type === "browse") {
      const ops = Array.isArray(action.ops) ? action.ops.slice(0, 8) : [];
      return NextResponse.json({
        done: false, thought,
        actionText: `browse ${(action.url ?? "(same page)").slice(0, 80)} · ${ops.length} op(s)`,
        delegate: { kind: "browse", url: action.url ?? "", ops },
      });
    }

    if (action.type === "need_login") return NextResponse.json({ done: false, thought, ask: { kind: "login", site: action.site ?? "" } });

    if (action.type === "ask_user") {
      const options = Array.isArray(action.options) ? action.options.filter((o) => typeof o === "string" && o.trim()).slice(0, 8) : [];
      return NextResponse.json({
        done: false, thought,
        ask: { kind: options.length > 0 ? "choice" : "text", question: action.question ?? "The agent needs your input.", options },
      });
    }

    if (typeof action.x === "number" && typeof action.y === "number" && action.x <= 1 && action.y <= 1 && (!Number.isInteger(action.x) || !Number.isInteger(action.y))) {
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
        if (!value) actionText = `FAILED type_secret: no ${field} available — use need_login first.`;
        else {
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
    return NextResponse.json({ error: err instanceof Error ? err.message : "Step failed." }, { status: 500 });
  }
}