import { baseUrlOf, jsonResponse, preflight, protectedResourceMetadata } from "@/lib/mcp/oauth-core.ts";

export const runtime = "nodejs";

// Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp
export async function GET(req: Request) { return jsonResponse(protectedResourceMetadata(baseUrlOf(req))); }
export const OPTIONS = preflight;
