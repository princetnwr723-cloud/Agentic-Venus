// AgenticVenus's own scheduler. It does not touch Vercel Cron at all: run it wherever you control
// (a laptop left on, a cheap VPS, a Raspberry Pi, a Daytona sandbox). It calls the same four endpoints
// as the GitHub Actions workflow, so you can run BOTH for redundancy: the server uses leases, so a
// routine can never run twice because two schedulers called it.
//
// Usage:
//   APP_URL=https://your-app.vercel.app ROUTINE_RUNNER_SECRET=xxxx npm run routines:run
//
// Optional:
//   CHECK_INTERVAL_MS=300000   (default: every 5 minutes, minimum 1 minute)

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const SECRET = process.env.ROUTINE_RUNNER_SECRET;
const BASE_MS = Math.max(60_000, Number(process.env.CHECK_INTERVAL_MS || 5 * 60 * 1000));
const PATHS = ["/api/routines/run", "/api/runner/tick", "/api/missions/tick", "/api/proactive/tick"];

if (!APP_URL || !SECRET) {
  console.error("Set APP_URL and ROUTINE_RUNNER_SECRET before running this.");
  process.exit(1);
}

let failures = 0; // consecutive rounds where something failed: the pause grows, so a down server is not hammered
let stopped = false;

async function call(path) {
  const res = await fetch(APP_URL + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(58_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${data.error || ""}`.trim());
  return data;
}

async function round() {
  const stamp = new Date().toISOString();
  const results = await Promise.allSettled(PATHS.map(call));
  let bad = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") { bad++; console.error(stamp, PATHS[i], "failed:", r.reason instanceof Error ? r.reason.message : r.reason); }
  });
  const routines = results[0].status === "fulfilled" ? results[0].value : null;
  if (routines && (routines.checked > 0 || routines.dispatched > 0)) console.log(stamp, "routines:", JSON.stringify(routines));
  failures = bad ? failures + 1 : 0;
}

async function loop() {
  console.log(`AgenticVenus scheduler started: ${PATHS.length} endpoints on ${APP_URL} every ${BASE_MS / 1000}s. Ctrl+C to stop.`);
  while (!stopped) {
    try { await round(); } catch (e) { failures++; console.error(new Date().toISOString(), "round failed:", e); }
    const wait = Math.min(30 * 60_000, BASE_MS * 2 ** Math.min(failures, 4)) + Math.floor(Math.random() * 5_000);
    await new Promise((r) => setTimeout(r, wait));
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopped = true; console.log("Stopping after this round."); setTimeout(() => process.exit(0), 100); });
loop();