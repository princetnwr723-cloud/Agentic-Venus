export type Risk = "read" | "write";
export type ToolSpec = { name: string; description: string; params: string; risk: Risk; source: string };
export type ToolResult = { ok: boolean; text: string; needsApproval?: { summary: string; risk: Risk } };