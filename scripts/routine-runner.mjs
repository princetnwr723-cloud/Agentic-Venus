// AgenticVenus's own scheduler. This is the whole point of "personal" —
// it doesn't touch Vercel Cron at all. Run it wherever you control:
// your own laptop left on, a cheap always-on VPS, a Raspberry Pi, or even
// inside a Daytona sandbox. As long as this process is alive, your
// routines run on schedule; Vercel just hosts the app it talks to.
//
// Usage:
//   APP_URL=https://your-app.vercel.app ROUTINE_RUNNER_SECRET=xxxx npm run routines:run
//
// Optional:
//   CHECK_INTERVAL_MS=300000   (default: check every 5 minutes)

const APP_URL = process.env.APP_URL;
const SECRET = process.env.ROUTINE_RUNNER_SECRET;
const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 5 * 60 * 1000);

if (!APP_URL || !SECRET) {
  console.error(
    "Set APP_URL and ROUTINE_RUNNER_SECRET before running this (see README → Routines)."
  );
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${APP_URL}/api/routines/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    const data = await res.json();
    const stamp = new Date().toISOString();
    if (!res.ok) {
      console.error(stamp, "routine-runner error:", data);
    } else if (data.checked > 0) {
      console.log(stamp, `checked ${data.checked} due routine(s):`, data.results);
    } else {
      console.log(stamp, "no routines due.");
    }
  } catch (err) {
    console.error(new Date().toISOString(), "routine-runner request failed:", err);
  }
}

console.log(
  `AgenticVenus routine runner started — polling ${APP_URL} every ${
    INTERVAL_MS / 1000
  }s. Ctrl+C to stop.`
);
tick();
setInterval(tick, INTERVAL_MS);
