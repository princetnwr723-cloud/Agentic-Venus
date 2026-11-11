// Shared types of the server-side agent. No runtime code and no imports: safe in the browser, on the server and in tests.

export type Prop = { type?: "string" | "number" | "integer" | "boolean" | "array" | "object"; description?: string; items?: Prop; enum?: string[] };
export type JsonSchema = { type: "object"; properties: Record<string, Prop>; required?: string[] };
export type ToolDef = { name: string; description: string; schema: JsonSchema; risk?: "read" | "write" };

export type TextBlock = { type: "text"; text: string };
/** meta = provider specific data that must travel back with the call (Gemini thought signatures). */
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; meta?: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;
export type AgentMsg = { role: "user" | "assistant"; content: Block[] };

export type Usage = { inTok: number; outTok: number; cacheRead: number; cacheWrite: number };
export type ModelCall = { id: string; name: string; input: Record<string, unknown>; raw?: string; meta?: Record<string, unknown> };
export type ModelTurn = { text: string; calls: ModelCall[]; stop: "end" | "tool_use" | "max_tokens" | "other"; usage: Usage };

export type PendingKind = "approve_tool" | "ask_user" | "request_approval" | "request_secret" | "request_takeover";
/** A card the owner has to answer. The run sleeps until then. */
export type Pending = {
  id: string;
  kind: PendingKind;
  toolUseId: string;
  name: string;
  summary: string;
  question?: string;
  options?: string[];
  secretName?: string;
  args?: Record<string, unknown>;
  tainted?: boolean;
  createdAt: number;
  expiresAt: number;
};

export type Reply =
  | { action: "answer"; text: string }
  | { action: "approve" }
  | { action: "deny"; note?: string }
  | { action: "secret"; name: string }
  | { action: "takeover_done"; seconds: number; note?: string; reason?: string }
  | { action: "timeout" };

export type RunStatus = "queued" | "running" | "paused" | "done" | "error" | "stopped" | "budget";

export type AgentEvent = { kind: "start" | "text" | "tool" | "result" | "pause" | "resume" | "compact" | "retry" | "error" | "done" | "latch" | "info"; text: string; data?: Record<string, unknown> };

export type RunState = {
  task: string;
  summary: string;
  messages: AgentMsg[];
  round: number;
  tainted: boolean;
  queue: ModelCall[];
  turnResults: ToolResultBlock[];
  pending: Pending | null;
  /** id of a write tool that started but never reported back (the function died): it is NOT run again blindly */
  inflight: string | null;
  usage: Usage;
  costMicros: number;
  nudges: number;
  calls: number;
  compactions: number;
  lastText: string;
};

export type Latch = { until: number; reason: string; kind: "provider" | "plan" | "cost"; armedAt: number };
