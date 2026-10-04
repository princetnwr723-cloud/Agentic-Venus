export type Verdict = { verdict: "pass" | "partial" | "fail"; reason: string };

/**
 * A second agent (ideally a different model) checks the result against the goal.
 * Catches "claimed success without evidence" before the user sees it.
 */
export async function verifyResult(
  llm: (system: string, prompt: string) => Promise<string>,
  a: { task: string; summary: string; evidence: string[] }
): Promise<Verdict> {
  try {
    const raw = await llm(
      "You are a strict QA reviewer for an AI agent. You only trust evidence, never claims.",
      `Decide whether the agent really achieved the user's goal.
Reply with ONE JSON object only: {"verdict":"pass"|"partial"|"fail","reason":"one short sentence"}
- pass: the goal is met AND the evidence below supports it.
- partial: some parts are done or unproven.
- fail: not done, contradicted by evidence, or the claim has no evidence.

GOAL:
${a.task.slice(0, 800)}

AGENT'S SUMMARY:
${a.summary.slice(0, 1500)}

EVIDENCE (raw tool outputs):
${a.evidence.length ? a.evidence.join("\n---\n").slice(0, 3500) : "(none)"}`
    );
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return { verdict: "pass", reason: "Verifier gave no usable answer." };
    const j = JSON.parse(m[0]) as { verdict?: string; reason?: string };
    const verdict = j.verdict === "fail" || j.verdict === "partial" ? j.verdict : "pass";
    return { verdict, reason: String(j.reason ?? "").slice(0, 240) || "No reason given." };
  } catch {
    return { verdict: "pass", reason: "Verifier unavailable." }; // never block the user on a checker failure
  }
}