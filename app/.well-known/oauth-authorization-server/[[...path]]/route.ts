import { authServerMetadata, baseUrlOf, jsonResponse, preflight } from "@/lib/mcp/oauth-core.ts";

export const runtime = "nodejs";

export async function GET(req: Request) { return jsonResponse(authServerMetadata(baseUrlOf(req))); }
export const OPTIONS = preflight;
