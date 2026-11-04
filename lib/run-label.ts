// Turns whatever the agent is really doing (long internal step texts, tool names, product names) into ONE short,
// generic phrase for the chat's run bar: "Running a command", "Working", "Thinking" ... No internal step is ever shown.

export type RunKind = "command" | "write" | "read" | "search" | "think" | "team" | "work";

/** What the bar says while it is going on. */
export const NOW: Record<RunKind, string> = {
  command: "Running a command",
  write: "Writing a file",
  read: "Reading a file",
  search: "Searching the web",
  think: "Thinking",
  team: "Team is working",
  work: "Working",
};

/** What a row in the opened list says once that part is over. */
export const DONE: Record<RunKind, string> = {
  command: "Ran a command",
  write: "Wrote a file",
  read: "Read a file",
  search: "Searched the web",
  think: "Thought it through",
  team: "Team worked on it",
  work: "Worked on it",
};

/** Picks the generic kind from who owns the work and the (internal) text of its current step. */
export function kindOf(owner: string | undefined, text: string | undefined): RunKind {
  const o = owner ?? "";
  if (o === "team" || o === "collab") return "team";
  if (o === "venus" || o === "recipe" || o === "connect") return "work";
  if (o === "pc" || o === "code" || o === "repo" || o === "deploy") return "command";
  const t = (text ?? "").toLowerCase();
  if (/command|terminal|shell|npm|install|clone|deploy|build|computer|sandbox|chala|chalu|\brun\b/.test(t)) return "command";
  if (/writ|likh|edit|updat|creat|draft|push|save/.test(t)) return "write";
  if (/\bread|padh/.test(t)) return "read";
  if (/search|dhund|browse|google|\bweb\b/.test(t)) return "search";
  if (/think|plan|samajh|understand|intent|dekh/.test(t)) return "think";
  return "work";
}