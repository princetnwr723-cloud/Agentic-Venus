package com.agenticvenus.app;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The "hands" of the phone computer, the same job the desktop app does (desktop/lib/relay-client.js): it asks the server
 * "is there work for me?" (long polling on /api/local), runs each job in the computer, and posts the answer back.
 * The server decides everything (plans, limits, what to run). The phone gets only jobs, and looks at every job again before it runs it.
 *
 * It does NOT keep running all day. It runs while the app is open, while the computer is running, for a while after the last job,
 * while the website's task runner keeps calling wake() (a task is running), and while a schedule alarm holds it (holdFor): a routine that
 * starts with the app closed can use this phone's computer. Then it stops and the phone is left alone.
 */
final class VenusLocalRelay {
    private static final long AFTER_JOB_MS = 30 * 60_000L; // server-side tasks think between jobs: stay reachable for a while
    private static final long WAKE_MS = 90_000L;

    private static VenusLocalRelay instance;

    static synchronized VenusLocalRelay get(Context ctx) {
        if (instance == null) instance = new VenusLocalRelay(ctx.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final VenusLocalComputer pc;
    private final ExecutorService jobs = Executors.newCachedThreadPool();
    private volatile boolean visible;
    private volatile long lastJobAt;
    private volatile long wakeAt;
    private volatile long holdUntil;
    private Thread loop;

    private VenusLocalRelay(Context ctx) {
        app = ctx;
        pc = VenusLocalComputer.get(ctx);
    }

    void setVisible(boolean v) {
        visible = v;
        if (v) ensure();
    }

    /** The website says "a task is running, stay online". */
    void wake() {
        wakeAt = System.currentTimeMillis();
        ensure();
    }

    /**
     * A schedule alarm fired (the app may be closed): stay online for `ms` so the routine's server-side agent can use this phone's computer.
     * The notification (foreground service) keeps Android from freezing the app and keeps the network open. It ends with the hold.
     */
    void holdFor(long ms) {
        if (!pc.enabled() || !pc.installed() || !VenusCore.configured(app)) return;
        holdUntil = Math.max(holdUntil, System.currentTimeMillis() + ms);
        VenusLocalService.sync(app, true, "Schedule ka kaam: phone online hai");
        ensure();
    }

    private boolean shouldRun() {
        if (!pc.enabled() || !pc.installed() || !VenusCore.configured(app)) return false;
        long now = System.currentTimeMillis();
        return visible || pc.isRunning() || now - lastJobAt < AFTER_JOB_MS || now - wakeAt < WAKE_MS || now < holdUntil;
    }

    synchronized void ensure() {
        if (!shouldRun()) return;
        if (loop != null && loop.isAlive()) return;
        loop = new Thread(this::run, "venus-computer-relay");
        loop.setDaemon(true);
        loop.start();
    }

    /** Signs this phone up as a computer of the account (once). Returns its id, or null when that is not possible right now. */
    String register() {
        String id = pc.deviceId();
        try {
            JSONObject b = new JSONObject().put("action", "register").put("name", (Build.MANUFACTURER + " " + Build.MODEL).trim()).put("platform", "android");
            if (id != null) b.put("deviceId", id);
            VenusCore.Res r = VenusCore.api(app, "POST", "/api/local", b.toString());
            if (r.code != 200) return id;
            String got = new JSONObject(r.body).optString("deviceId", "");
            if (!got.isEmpty()) { pc.setDeviceId(got); return got; }
        } catch (Exception ignored) { }
        return id;
    }

    private void run() {
        try { loop(); }
        finally {
            // the hold is over and the computer is not running: take the notification away (a running computer keeps its own)
            if (!pc.isRunning()) VenusLocalService.sync(app, false, "");
        }
    }

    private void loop() {
        int errors = 0;
        while (shouldRun()) {
            try {
                String id = pc.deviceId();
                if (id == null) id = register();
                if (id == null) { errors++; sleep(Math.min(30_000, 2_000L * errors)); continue; }
                VenusCore.Res r = VenusCore.api(app, "POST", "/api/local", new JSONObject().put("action", "poll").put("deviceId", id).toString(), 35_000);
                if (r.code == 400 || r.code == 403) { pc.setDeviceId(null); continue; } // this id is not ours (another account signed in): sign up again
                if (r.code != 200) throw new java.io.IOException("poll " + r.code);
                errors = 0;
                JSONArray list = new JSONObject(r.body.isEmpty() ? "{}" : r.body).optJSONArray("jobs");
                if (list == null) continue;
                for (int i = 0; i < list.length(); i++) {
                    final JSONObject job = list.getJSONObject(i);
                    lastJobAt = System.currentTimeMillis();
                    jobs.execute(() -> runJob(job));
                }
            } catch (Exception e) {
                errors++;
                sleep(Math.min(30_000, 1_500L * errors));
            }
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    private void runJob(JSONObject job) {
        String id = job.optString("id", "");
        String op = job.optString("op", "");
        JSONObject args = job.optJSONObject("args");
        JSONObject result;
        try {
            String bad = VenusLocalLogic.checkJob(id, op,
                    args == null ? null : args.optString("cmd", ""),
                    args == null ? null : args.optString("type", ""),
                    args == null ? null : args.optString("action", ""));
            result = bad != null ? new JSONObject().put("error", bad) : pc.runJob(op, args == null ? new JSONObject() : args);
        } catch (Throwable t) {
            String m = t.getMessage() == null ? t.toString() : t.getMessage();
            try { result = new JSONObject().put("error", m.length() > 400 ? m.substring(0, 400) : m); } catch (Exception e) { return; }
        }
        lastJobAt = System.currentTimeMillis();
        try {
            String devId = pc.deviceId();
            if (devId == null || id.isEmpty()) return;
            VenusCore.api(app, "POST", "/api/local", new JSONObject().put("action", "result").put("deviceId", devId).put("jobId", id).put("result", result).toString());
        } catch (Exception ignored) { /* the server gives up on a job after 10 minutes */ }
    }
}