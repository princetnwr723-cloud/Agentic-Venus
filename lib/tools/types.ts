export type Risk = "read" | "write";
export type ToolSpec = { name: string; description: string; params: string; risk: Risk; source: string };
export type ToolResult = {
  ok: boolean; text: string;
  needsApproval?: { summary: string; risk: Risk };
  flagged?: string[];   // the output tried to instruct the agent (prompt injection)
  risk?: Risk;
};
/** Lets a tool save something for this chat (e.g. the agent's own inbox login) into the encrypted vault. */
export type ToolCtx = { uid: string; chatId: string; save: (key: string, value: string) => Promise<void> };
