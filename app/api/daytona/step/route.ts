// SAVE AS: app/api/daytona/step/route.ts
import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import { performAction, takeScreenshot, type PcAction } from "@/lib/daytona-server";
import type { ProviderId } from "@/lib/providers";

// One step per request (screenshot → model → action) keeps every call well
// inside the time limit; the browser loops until the agent says it's done.
export const maxDuration = 60;

const ALLOWED = new Set([
  "click",
  "double_click",
  "right_click",
  "type",
  "key",
  "scroll",
  "wait",
  "done",
]);

function systemPrompt(width: number, height: number) {
  return `You are an AI agent operating a Linux desktop (XFCE, with a web browser installed) by looking at screenshots. The screenshot is ${width}x${height} pixels; give coordinates in that pixel space, with (0,0) at the top-left.

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
{"type":"done","summary":"what you actually accomplished"}

Rules: click a text field before typing into it; one action per reply; if a page is still loading, wait; when the task is finished — or truly impossible — reply with "done" and an honest summary.`;
}

function parseStep(text: string): { thought: string; action: PcAction } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`The model didn't return an action: ${text.slice(0, 140)}`);
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    thought?: string;
    action?: PcAction;
  };
  if (!parsed.action || !ALLOWED.has(parsed.action.type)) {
    throw new Error(`The model returned an unusable action: ${text.slice(0, 140)}`);
  }
  return { thought: parsed.thought ?? "", action: parsed.action };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      daytonaKey,
      sandboxId,
      provider,
      apiKey,
      model,
      task,
      history,
    }: {
      daytonaKey: string;
      sandboxId: string;
      provider: ProviderId;
      apiKey: string;
      model: string;
      task: string;
      history: string[];
    } = body;

    if (!daytonaKey || !sandboxId || !apiKey || !provider || !model || !task) {
      return NextResponse.json({ error: "Missing something needed to run a step." }, { status: 400 });
    }

    const shot = await takeScreenshot(daytonaKey, sandboxId);

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

    const { thought, action } = parseStep(reply);

    if (action.type === "done") {
      return NextResponse.json({ done: true, thought, summary: action.summary ?? "Done." });
    }

    // Keep clicks inside the real screen even if the model over-shoots.
    if (typeof action.x === "number") action.x = Math.min(Math.max(action.x, 0), shot.width - 1);
    if (typeof action.y === "number") action.y = Math.min(Math.max(action.y, 0), shot.height - 1);

    let actionText: string;
    try {
      actionText = await performAction(daytonaKey, sandboxId, action);
    } catch (err) {
      // Tell the model (via the step log) what failed so the next step can adapt.
      actionText = `FAILED ${action.type}: ${err instanceof Error ? err.message : "unknown error"}`;
    }

    // Give the screen a moment to react before the next screenshot.
    await new Promise((r) => setTimeout(r, 1200));

    return NextResponse.json({ done: false, thought, actionText });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Step failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}