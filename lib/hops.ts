// Vercel refuses a chain of calls from one function to the SAME deployment once it is 6 deep ("508 INFINITE_LOOP_DETECTED").
// The platform puts one entry per hop in the x-vercel-id header ("iad1:iad1:iad1::<id>"). This file reads that count, so a background
// step that is already deep can start the next step from OUTSIDE Vercel (see lib/kick-relay.ts) instead of calling itself.
import { AsyncLocalStorage } from "node:async_hooks";

/** The 6th chained call is refused. */
export const MAX_HOPS = 5;
/** A step that is this deep (or deeper) must not call the next step directly: that step makes calls of its own, so it needs 1-2 spare hops. */
export const SAFE_KICK_HOPS = 3;

const als = new AsyncLocalStorage<{ hops: number }>();

/** Number of hops in an x-vercel-id value. Unknown or empty counts as 1 (the request itself). */
export function hopsOf(id: string | null | undefined): number {
  if (!id) return 1;
  const first = String(id).slice(0, 400).split("::")[0];
  return Math.max(1, first.split(":").filter(Boolean).length);
}

/** Call at the top of a step route: everything that runs inside that request now knows how deep it is. */
export function enterHops(req: Request): number {
  const hops = hopsOf(req.headers.get("x-vercel-id"));
  als.enterWith({ hops });
  return hops;
}

/** Depth of the request we are running in. Outside a request that called enterHops it is assumed to be 2 (a normal single hop plus the call itself). */
export function currentHops(): number {
  return als.getStore()?.hops ?? 2;
}

/** True when a step at this depth may call the next step directly. */
export const canKickDirect = (hops = currentHops()): boolean => hops <= SAFE_KICK_HOPS;
