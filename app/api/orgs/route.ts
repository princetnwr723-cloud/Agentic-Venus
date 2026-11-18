import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { isRole, publicView } from "@/lib/orgs-core";
import { changeRole, createInvite, createLinkCode, createOrg, deleteOrg, joinWithCode, listOrgsFor, removeMember } from "@/lib/orgs-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const id = (v: unknown) => { const s = String(v ?? ""); if (!/^[A-Za-z0-9]{10,40}$/.test(s)) throw new RequestError("A valid workspace id is required.", 400); return s; };

// Shared workspaces: create one, invite people, set roles, link a member's Slack account.
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const name = String(body.name ?? "").slice(0, 60);
    switch (String(body.action || "list")) {
      case "list": return NextResponse.json({ ok: true, orgs: (await listOrgsFor(uid)).map(publicView) });
      case "create": return NextResponse.json({ ok: true, org: publicView(await createOrg(uid, { name: String(body.orgName ?? "Team"), chatId: String(body.chatId ?? ""), ownerName: name })) });
      case "invite": {
        const role = body.role;
        if (!isRole(role)) throw new RequestError("Pick a role: admin, member or viewer.", 400);
        return NextResponse.json({ ok: true, ...(await createInvite(id(body.orgId), uid, role)) });
      }
      case "join": return NextResponse.json({ ok: true, org: publicView(await joinWithCode(uid, name || "Member", String(body.code ?? ""))) });
      case "set_role": {
        if (!isRole(body.role)) throw new RequestError("Unknown role.", 400);
        return NextResponse.json({ ok: true, org: publicView(await changeRole(id(body.orgId), uid, String(body.targetUid ?? ""), body.role)) });
      }
      case "remove": return NextResponse.json({ ok: true, org: publicView(await removeMember(id(body.orgId), uid, String(body.targetUid || uid))) });
      case "slack_link_code": return NextResponse.json({ ok: true, ...(await createLinkCode(id(body.orgId), uid)), how: "Send this to the Slack bot as a direct message within 15 minutes: link <code>" });
      case "delete": await deleteOrg(id(body.orgId), uid); return NextResponse.json({ ok: true });
      default: throw new RequestError("Unknown action.", 400);
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Request failed." }, { status: requestStatus(err) });
  }
}
