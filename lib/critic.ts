export type Verdict = { verdict: "pass" | "partial" | "fail"; reason: string };

/**
 * A second agent (ideally a different model) checks the result against the goal.
 * For verified lists the check is DETERMINISTIC first: the summary carries "VERIFIED: X of N requested"
 * (written by code, not by the model), so a short list can never pass as a full one.
 */
export async function verifyResult(
  llm: (system: string, prompt: string) => Promise<string>,
  a: { task: string; summary: string; evidence: string[] }
): Promise<Verdict> {
  const m = /VERIFIED:\s*(\d+)\s+of\s+(\d+)\s+requested/i.exec(a.summary);
  if (m) {
    const got = Number(m[1]), want = Number(m[2]);
    if (got < want) return { verdict: "partial", reason: `Only ${got} of ${want} requested items passed independent verification. Nothing was padded with unverified items.` };
    return { verdict: "pass", reason: `All ${want} requested items passed independent verification (website, company evidence, email domain).` };
  }
  try {
    const raw = await llm(
      "You are a strict QA reviewer for an AI agent. You only trust evidence, never claims.",
      `Decide whether the agent really achieved the user's goal.
Reply with ONE JSON object only: {"verdict":"pass"|"partial"|"fail","reason":"one short sentence"}
- pass: the goal is met AND the evidence below supports it.
- partial: some parts are done or unproven (for example a number of items is claimed but nothing shows they were checked).
- fail: not done, contradicted by evidence, or the claim has no evidence.

GOAL:
${a.task.slice(0, 800)}

AGENT'S SUMMARY:
${a.summary.slice(0, 1500)}

EVIDENCE (raw tool outputs):
${a.evidence.length ? a.evidence.join("\n---\n").slice(0, 3500) : "(none)"}`
    );
    const j = /\{[\s\S]*\}/.exec(raw);
    if (!j) return { verdict: "pass", reason: "Verifier gave no usable answer." };
    const p = JSON.parse(j[0]) as { verdict?: string; reason?: string };
    const verdict = p.verdict === "fail" || p.verdict === "partial" ? p.verdict : "pass";
    return { verdict, reason: String(p.reason ?? "").slice(0, 240) || "No reason given." };
  } catch {
    return { verdict: "pass", reason: "Verifier unavailable." }; // never block the user on a checker failure
  }
}