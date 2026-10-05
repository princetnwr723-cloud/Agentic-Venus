import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import { readBody } from "@/lib/request";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { provider, apiKey, model, task, context } = (await readBody(req)) as {
      provider: ProviderId; apiKey: string; model: string; task: string; context?: string;
    };
    if (!provider || !apiKey || !model || !task) return NextResponse.json({ error: "Missing fields." }, { status: 400 });

    const reply = await callProvider({
      provider, apiKey, model, maxTokens: 1200,
      messages: [{
        role: "user",
        content: `You plan work for an AI agent that controls a Linux computer (browser, terminal) and can hand coding work to a coding agent.
Split the task into 1-6 ordered subtasks ONLY if it really has several distinct parts. A simple task is ONE subtask. Each subtask has a clear goal with an expected result.
Reply with JSON only: {"subtasks":[{"title":"max 8 words","goal":"one clear sentence incl. the expected result","tool":"browser|terminal|code|desktop|research"}]}
Pick the tool a person would naturally use: research = reading the web; browser = real browsing/forms/logins; terminal = installing/running commands; code = building or changing a project; desktop = other apps.${context ? "\n\nKnown context:" + context.slice(0, 1500) : ""}

TASK: ${task.slice(0, 1500)}`,
      }],
    });
    const a = reply.indexOf("{");
    const b = reply.lastIndexOf("}");
    const parsed = a >= 0 && b > a ? JSON.parse(reply.slice(a, b + 1)) : null;
    const subtasks = (Array.isArray(parsed?.subtasks) ? parsed.subtasks : [])
      .slice(0, 6)
      .map((s: any) => ({ title: String(s?.title ?? "Step").slice(0, 80), goal: String(s?.goal ?? "").slice(0, 400), tool: String(s?.tool ?? "") }))
      .filter((s: { goal: string }) => s.goal);
    return NextResponse.json({ subtasks: subtasks.length ? subtasks : [{ title: "Do the task", goal: task, tool: "" }] });
  } catch {
    return NextResponse.json({ subtasks: [] });
  }
}
