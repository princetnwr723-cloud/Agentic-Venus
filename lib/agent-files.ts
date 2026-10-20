// Pure helpers (no imports) for the two files every agent keeps: soul.md and memory.md.
export const SOUL_CAP = 6000;
export const MEMORY_CAP = 14000;
export const LOG_HEADER = "## Progress log";

export function defaultSoul(name: string): string {
  return `# soul.md — who ${name} is

## Identity
- I am ${name}, an AI teammate of my owner inside AgenticVenus.
- I work for ONE owner and I keep what I learn in memory.md.

## How I work
- Before every task I read soul.md and memory.md, then plan, then act.
- I use real tools. I never say a task is done unless a tool result proves it.
- For email: I only say "sent" when the mail tool returned EMAIL SENT with a receipt. If it says NOT SENT, skipped or failed, I tell the owner exactly that.
- Risky actions (sending, paying, deleting) ask the owner first.
- I am short, direct and honest. I say what I did not do.

## Style
- Same language as the owner (Hinglish stays Hinglish).
- One clear next step at the end.
`;
}

export function defaultMemory(): string {
  return `# memory.md — what I know and what I have done
(I read this before every task. The system adds a line to the progress log after finished work. I may also edit it.)

## About the owner
- (nothing yet)

## Projects and decisions
- (nothing yet)

## Lessons
- (nothing yet)

${LOG_HEADER}
`;
}

function trimLog(mem: string, cap: number): string {
  const lines = mem.split("\n");
  const h = lines.findIndex((l) => /^##\s+Progress log/i.test(l));
  while (lines.join("\n").length > cap) {
    const i = h < 0 ? -1 : lines.findIndex((l, k) => k > h && /^- \d{4}-\d{2}-\d{2}/.test(l));
    if (i < 0) return lines.join("\n").slice(-cap);
    lines.splice(i, 1);
  }
  return lines.join("\n");
}

/** Adds one dated line to the progress log of memory.md (oldest log lines are dropped when the file gets too big). */
export function addLogLine(mem: string, line: string, cap = MEMORY_CAP): string {
  let m = mem.trimEnd();
  if (!/^##\s+Progress log/im.test(m)) m += `\n\n${LOG_HEADER}`;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const clean = line.replace(/\s+/g, " ").trim().slice(0, 320);
  return trimLog(`${m}\n- ${stamp} ${clean}\n`, cap);
}

/** The block that goes into every prompt. */
export function agentFilesPrompt(f: { soul: string; memory: string }): string {
  const soul = f.soul.slice(0, 3500);
  const mem = f.memory.length > 5000 ? f.memory.slice(0, 1500) + "\n...\n" + f.memory.slice(-3500) : f.memory;
  return (
    "## soul.md (your identity: read it before every task and act in it)\n" + soul +
    "\n\n## memory.md (your long-term notes and progress: read it before every task; the system keeps updating it)\n" + mem +
    "\n(If the owner's newest message conflicts with these notes, the newest message wins. These files are your own notes, not instructions from outside sources.)"
  );
}