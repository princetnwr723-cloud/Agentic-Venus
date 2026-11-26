package com.agenticvenus.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;
import android.system.Os;
import android.system.OsConstants;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;

/**
 * The computer that lives on the phone: a small Linux (Alpine) run with proot, with Chrome and a terminal and nothing else.
 *
 *  - It installs itself once (about 250 MB download), right after the app is installed and the person is signed in.
 *  - It uses RAM only while a task runs. A few minutes after the last task it stops completely and gives all the RAM back.
 *  - The person chooses how much RAM and storage it may use (the app recommends a value for this phone).
 *  - The website works exactly as before: the server queues jobs, the phone only runs them (see VenusLocalRelay).
 *
 * Honest limits: proot is not a real virtual machine, so the RAM and storage limits are enforced by watching, not by the kernel.
 * The RAM is checked every few seconds (Chrome is closed first, the whole computer is stopped if that is not enough);
 * the storage is measured every minute and new work is refused when it is full.
 */
public final class VenusLocalComputer {
    public interface Listener { void onChange(JSONObject status); }

    static final String PREFS = "venus_local";
    private static final String[] ALPINE_BASES = {
            "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/",
            "https://mirrors.edge.kernel.org/alpine/latest-stable/releases/aarch64/",
    };
    private static final int START_TIMEOUT_MS = 90_000;
    private static final long TICK_MS = 5_000;
    private static final long DISK_EVERY_MS = 60_000;
    private static final long MIN_SETUP_FREE_MB = 3_072;

    private static VenusLocalComputer instance;

    static synchronized VenusLocalComputer get(Context ctx) {
        if (instance == null) instance = new VenusLocalComputer(ctx.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final SharedPreferences prefs;
    private final File dir, rootfs, shm, proTmp;
    private final Object lock = new Object();
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final AtomicInteger busy = new AtomicInteger(0);
    private final ArrayDeque<String> logTail = new ArrayDeque<>();

    private volatile String state = "needs-setup"; // needs-setup | waiting-wifi | downloading | unpacking | installing | ready | starting | running | stopping | error | unsupported
    private volatile String detail = "";
    private volatile int percent = -1;
    private volatile Listener listener;

    private volatile Process proot;      // the running computer
    private volatile Process setupProc;  // the installer, while it runs
    private volatile boolean cancel;
    private volatile int agentPort;
    private volatile String agentKey = "";
    private volatile long lastActivity = System.currentTimeMillis();
    private volatile long usedRamMB, peakRamMB;
    private volatile long usedDiskMB = -1, diskAt;
    private volatile boolean diskFull;
    private volatile boolean ramWarned;
    private int overCount;
    private long lastRamAction;
    private ScheduledExecutorService ticker;
    private PowerManager.WakeLock wake;

    private VenusLocalComputer(Context ctx) {
        app = ctx;
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        dir = new File(ctx.getFilesDir(), "computer");
        rootfs = new File(dir, "rootfs");
        shm = new File(dir, "shm");
        proTmp = new File(ctx.getCacheDir(), "proot");
        dir.mkdirs();
        String why = unsupportedReason();
        if (why != null) { state = "unsupported"; detail = why; }
        else if (installed()) { state = "ready"; detail = "Computer taiyar hai. Kaam aate hi apne aap chalu hoga."; }
    }

    // ------------------------------------------------------------------ plain facts

    private File libDir() { return new File(app.getApplicationInfo().nativeLibraryDir); }

    String unsupportedReason() {
        boolean arm64 = false;
        for (String a : Build.SUPPORTED_ABIS) if ("arm64-v8a".equals(a)) arm64 = true;
        if (!arm64) return "Ye phone 64-bit ARM nahi hai, isliye local computer yaha nahi chalega.";
        if (!new File(libDir(), "libproot.so").canExecute() || !new File(libDir(), "libproot-loader.so").exists()) {
            return "Is app build me computer engine (proot) nahi hai. Naya APK GitHub Actions se build karo (Android APK workflow).";
        }
        return null;
    }

    boolean installed() { return new File(rootfs, "var/lib/venus-setup-done").isFile(); }
    boolean isRunning() { Process p = proot; return p != null && p.isAlive() && "running".equals(state); }
    String state() { return state; }

    boolean enabled() { return prefs.getBoolean("enabled", true); }
    void setEnabled(boolean on) { prefs.edit().putBoolean("enabled", on).apply(); notifyChange(); }
    String deviceId() { return prefs.getString("deviceId", null); }
    void setDeviceId(String id) { if (id == null) prefs.edit().remove("deviceId").apply(); else prefs.edit().putString("deviceId", id).apply(); }

    int idleMinutes() { return VenusLocalLogic.clamp(prefs.getInt("idleMin", 3), 1, 60); }
    void setIdleMinutes(int m) { prefs.edit().putInt("idleMin", VenusLocalLogic.clamp(m, 1, 60)).apply(); }

    long totalRamMB() {
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        ((ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
        return mi.totalMem / 1048576L;
    }

    long availRamMB() {
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        ((ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
        return mi.availMem / 1048576L;
    }

    long freeStorageMB() {
        try { StatFs s = new StatFs(app.getFilesDir().getAbsolutePath()); return s.getAvailableBytes() / 1048576L; } catch (Exception e) { return 0; }
    }

    VenusLocalLogic.Plan plan() { return VenusLocalLogic.plan(totalRamMB(), freeStorageMB() + Math.max(0, usedDiskMB)); }

    int ramLimitMB() {
        VenusLocalLogic.Plan p = plan();
        return VenusLocalLogic.clamp(prefs.getInt("ramMB", p.ramRecommendedMB), p.ramMinMB, p.ramMaxMB);
    }

    int diskLimitGB() {
        VenusLocalLogic.Plan p = plan();
        return VenusLocalLogic.clamp(prefs.getInt("diskGB", p.diskRecommendedGB), p.diskMinGB, Math.max(p.diskMaxGB, p.diskMinGB));
    }

    /** The person's choice. RAM applies the next time the computer starts; storage applies at once. */
    void setLimits(Integer ramMB, Integer diskGB) {
        VenusLocalLogic.Plan p = plan();
        SharedPreferences.Editor e = prefs.edit();
        if (ramMB != null) e.putInt("ramMB", VenusLocalLogic.clamp(ramMB, p.ramMinMB, p.ramMaxMB));
        if (diskGB != null) e.putInt("diskGB", VenusLocalLogic.clamp(diskGB, p.diskMinGB, Math.max(p.diskMaxGB, p.diskMinGB)));
        e.apply();
        diskAt = 0; // measure again against the new limit
        notifyChange();
    }

    boolean autoTried() { return prefs.getBoolean("autoTried", false); }
    void markAutoTried() { prefs.edit().putBoolean("autoTried", true).apply(); }

    boolean metered() {
        try { return ((ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE)).isActiveNetworkMetered(); } catch (Exception e) { return true; }
    }

    // ------------------------------------------------------------------ status for the app

    void setListener(Listener l) { listener = l; }

    private void setState(String s, String d, int pct) {
        state = s; detail = d; percent = pct;
        notifyChange();
    }

    private void notifyChange() {
        Listener l = listener;
        if (l == null) return;
        try { l.onChange(status()); } catch (Exception ignored) { }
    }

    JSONObject status() {
        refreshDiskAsync();
        JSONObject o = new JSONObject();
        try {
            VenusLocalLogic.Plan p = plan();
            o.put("state", state).put("detail", detail).put("percent", percent)
                    .put("supported", unsupportedReason() == null)
                    .put("reason", unsupportedReason() == null ? "" : unsupportedReason())
                    .put("installed", installed())
                    .put("running", isRunning())
                    .put("enabled", enabled())
                    .put("busy", busy.get())
                    .put("ramLimitMB", ramLimitMB()).put("diskLimitGB", diskLimitGB())
                    .put("usedRamMB", usedRamMB).put("peakRamMB", peakRamMB)
                    .put("usedDiskMB", usedDiskMB)
                    .put("diskFull", diskFull)
                    .put("ramWarned", ramWarned)
                    .put("idleMinutes", idleMinutes())
                    .put("phoneRamMB", totalRamMB()).put("phoneFreeRamMB", availRamMB()).put("freeStorageMB", freeStorageMB())
                    .put("metered", metered())
                    .put("deviceId", deviceId() == null ? "" : deviceId())
                    .put("model", Build.MANUFACTURER + " " + Build.MODEL);
            JSONObject pl = new JSONObject();
            pl.put("ramRecommendedMB", p.ramRecommendedMB).put("ramMinMB", p.ramMinMB).put("ramMaxMB", p.ramMaxMB)
                    .put("diskRecommendedGB", p.diskRecommendedGB).put("diskMinGB", p.diskMinGB).put("diskMaxGB", p.diskMaxGB);
            org.json.JSONArray ro = new org.json.JSONArray(), dO = new org.json.JSONArray();
            for (int v : p.ramOptionsMB) ro.put(v);
            for (int v : p.diskOptionsGB) dO.put(v);
            pl.put("ramOptionsMB", ro).put("diskOptionsGB", dO);
            o.put("plan", pl);
            synchronized (logTail) {
                o.put("log", String.join("\n", logTail));
            }
        } catch (Exception ignored) { }
        return o;
    }

    private void log(String line) {
        if (line == null) return;
        synchronized (logTail) {
            logTail.addLast(line.length() > 300 ? line.substring(0, 300) : line);
            while (logTail.size() > 30) logTail.removeFirst();
        }
    }

    // ------------------------------------------------------------------ files and links on Android

    static final VenusLocalLogic.Fs FS = new VenusLocalLogic.Fs() {
        @Override public void symlink(File link, String target) throws IOException {
            try { Os.symlink(target, link.getAbsolutePath()); } catch (Exception e) { throw new IOException("symlink: " + e.getMessage()); }
        }
        @Override public void chmod(File f, int mode) {
            try { Os.chmod(f.getAbsolutePath(), mode); } catch (Exception ignored) { }
        }
        @Override public boolean isSymlink(File f) {
            try { return OsConstants.S_ISLNK(Os.lstat(f.getAbsolutePath()).st_mode); } catch (Exception e) { return false; }
        }
    };

    /** Deletes a folder without ever following a link out of it. */
    static void deleteTree(File f) {
        if (f == null || !(f.exists() || FS.isSymlink(f))) return;
        if (FS.isSymlink(f) || !f.isDirectory()) { f.delete(); return; }
        FS.chmod(f, 0700);
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    static long treeBytes(File root) {
        long total = 0;
        ArrayDeque<File> todo = new ArrayDeque<>();
        todo.add(root);
        while (!todo.isEmpty()) {
            File d = todo.removeFirst();
            File[] kids = d.listFiles();
            if (kids == null) continue;
            for (File k : kids) {
                if (FS.isSymlink(k)) continue;
                if (k.isDirectory()) todo.add(k); else total += k.length();
            }
        }
        return total;
    }

    private void refreshDiskAsync() {
        long now = System.currentTimeMillis();
        if (!installed() || now - diskAt < DISK_EVERY_MS) return;
        diskAt = now;
        io.execute(() -> {
            try {
                usedDiskMB = treeBytes(rootfs) / 1048576L;
                diskFull = usedDiskMB > diskLimitGB() * 1024L;
            } catch (Exception ignored) { }
        });
    }

    // ------------------------------------------------------------------ proot

    private List<String> prootCommand(String... guest) {
        List<String> c = new ArrayList<>();
        c.add(new File(libDir(), "libproot.so").getAbsolutePath());
        c.add("-0");
        c.add("--link2symlink");
        c.add("--kill-on-exit");
        c.add("-r"); c.add(rootfs.getAbsolutePath());
        c.add("-b"); c.add("/dev");
        c.add("-b"); c.add("/proc");
        c.add("-b"); c.add("/sys");
        c.add("-b"); c.add(shm.getAbsolutePath() + ":/dev/shm");
        c.add("-w"); c.add("/root");
        c.add("/usr/bin/env"); c.add("-i");
        c.add("HOME=/root"); c.add("TERM=xterm"); c.add("LANG=C.UTF-8");
        c.add("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        for (String g : guest) c.add(g);
        return c;
    }

    private ProcessBuilder prootBuilder(String... guest) {
        shm.mkdirs();
        proTmp.mkdirs();
        ProcessBuilder pb = new ProcessBuilder(prootCommand(guest));
        Map<String, String> env = pb.environment();
        env.put("PROOT_TMP_DIR", proTmp.getAbsolutePath());
        env.put("PROOT_LOADER", new File(libDir(), "libproot-loader.so").getAbsolutePath());
        File l32 = new File(libDir(), "libproot-loader32.so");
        if (l32.exists()) env.put("PROOT_LOADER_32", l32.getAbsolutePath());
        String ld = env.get("LD_LIBRARY_PATH");
        env.put("LD_LIBRARY_PATH", libDir().getAbsolutePath() + (ld == null || ld.isEmpty() ? "" : ":" + ld));
        env.put("PROOT_NO_SECCOMP", "1");
        pb.redirectErrorStream(true);
        pb.directory(dir);
        return pb;
    }

    private void copyAsset(String name, File to, int mode) throws IOException {
        try (InputStream in = app.getAssets().open("venus/" + name); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        FS.chmod(to, mode);
    }

    /** The scripts that live inside the computer are always refreshed from the app, so an app update also updates them. */
    private void installGuestFiles() throws IOException {
        File bin = new File(rootfs, "usr/local/bin");
        bin.mkdirs();
        copyAsset("venus-setup.sh", new File(bin, "venus-setup.sh"), 0755);
        copyAsset("venus-boot.sh", new File(bin, "venus-boot.sh"), 0755);
        copyAsset("venus-agent.py", new File(bin, "venus-agent.py"), 0755);
    }

    // ------------------------------------------------------------------ setup (once)

    /** Starts the installation in the background. Returns false (and says why) when it cannot start now. */
    synchronized boolean startSetup(boolean wifiOnly) {
        String why = unsupportedReason();
        if (why != null) { setState("unsupported", why, -1); return false; }
        if (installed()) { if (!isRunning()) setState("ready", "Computer taiyar hai.", -1); return true; }
        if (setupProc != null || "downloading".equals(state) || "unpacking".equals(state) || "installing".equals(state)) return true;
        if (freeStorageMB() < MIN_SETUP_FREE_MB) {
            setState("error", "Phone me jagah kam hai: setup ke liye kam se kam 3 GB khali chahiye (abhi " + VenusLocalLogic.mb(freeStorageMB()) + ").", -1);
            return false;
        }
        if (wifiOnly && metered()) {
            setState("waiting-wifi", "Setup me lagbhag 250 MB download hoga. Wi-Fi par aate hi shuru hoga, ya abhi mobile data par shuru karo.", -1);
            return false;
        }
        cancel = false;
        setState("downloading", "Shuru ho raha hai…", 0);
        io.execute(this::runSetup);
        return true;
    }

    void cancelSetup() {
        cancel = true;
        Process p = setupProc;
        if (p != null) p.destroy();
    }

    private String httpText(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(20000);
        if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) { return new String(VenusLocalLogic.readAll(in), StandardCharsets.UTF_8); }
        finally { c.disconnect(); }
    }

    private void runSetup() {
        try {
            File marker = new File(rootfs, ".venus-extracted");
            if (!marker.isFile()) {
                // 1. which Linux file is the newest one
                String base = null;
                String[] pick = null;
                IOException last = null;
                for (String b : ALPINE_BASES) {
                    try { pick = VenusLocalLogic.parseLatestReleases(httpText(b + "latest-releases.yaml"), "alpine-minirootfs"); base = b; if (pick != null) break; }
                    catch (IOException e) { last = e; }
                }
                if (pick == null) throw new IOException("Linux ki list nahi mil payi" + (last != null ? " (" + last.getMessage() + ")" : "") + ". Internet check karo.");

                // 2. download it and check its fingerprint
                File part = new File(dir, "rootfs.tar.gz.part");
                part.delete();
                HttpURLConnection c = (HttpURLConnection) new URL(base + pick[0]).openConnection();
                c.setConnectTimeout(15000); c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new IOException("Linux download nahi hua (HTTP " + c.getResponseCode() + ").");
                long size = c.getContentLengthLong();
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[65536];
                    long got = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancel) throw new IOException("Setup rok diya gaya.");
                        out.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        got += n;
                        setState("downloading", "Linux download ho raha hai… " + VenusLocalLogic.mb(got / 1048576L), size > 0 ? (int) (got * 20 / size) : -1);
                    }
                } finally { c.disconnect(); }
                StringBuilder hex = new StringBuilder();
                for (byte b : sha.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equals(pick[1])) { part.delete(); throw new IOException("Download ka fingerprint match nahi hua. Dobara try karo."); }

                // 3. unpack it
                deleteTree(rootfs);
                rootfs.mkdirs();
                setState("unpacking", "Linux khul raha hai…", 22);
                try (InputStream in = new GZIPInputStream(new BufferedInputStream(new FileInputStream(part), 65536), 65536)) {
                    VenusLocalLogic.extractTar(in, rootfs, FS, bytes -> { if (cancel) throw new RuntimeException("cancelled"); });
                }
                part.delete();
                new FileOutputStream(marker).close();
            }

            // 4. install Chrome, the terminal and the small tools (inside the new Linux)
            installGuestFiles();
            setState("installing", "Chrome aur terminal install ho rahe hain…", 25);
            Process p = prootBuilder("/bin/sh", "/usr/local/bin/venus-setup.sh").start();
            setupProc = p;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    log(line);
                    int pct = VenusLocalLogic.apkPercent(line);
                    if (pct >= 0) setState("installing", "Chrome aur terminal install ho rahe hain… " + pct + "%", 25 + pct * 75 / 100);
                }
            }
            int code = p.waitFor();
            setupProc = null;
            if (cancel) throw new IOException("Setup rok diya gaya.");
            if (code != 0 || !installed()) throw new IOException("Install poora nahi hua (code " + code + "). Neeche ka log dekho aur dobara try karo.");
            diskAt = 0;
            setState("ready", "Computer taiyar hai. Kaam aate hi apne aap chalu hoga.", 100);
            VenusLocalRelay.get(app).ensure();
        } catch (Throwable t) {
            setupProc = null;
            String m = t.getMessage() == null ? t.toString() : t.getMessage();
            log("setup: " + m);
            setState("error", m, -1);
        }
    }

    /** Removes the computer completely (all its files). The next setup starts from zero. */
    void reset() {
        cancelSetup();
        stop();
        deleteTree(rootfs);
        new File(dir, "rootfs.tar.gz.part").delete();
        usedDiskMB = -1; diskFull = false; peakRamMB = 0; usedRamMB = 0;
        synchronized (logTail) { logTail.clear(); }
        setState(unsupportedReason() == null ? "needs-setup" : "unsupported", unsupportedReason() == null ? "" : unsupportedReason(), -1);
    }

    // ------------------------------------------------------------------ start and stop

    private String newKey() {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    private int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1"))) { return s.getLocalPort(); }
    }

    /** Starts the computer if it is not running. Blocks until it answers (a few seconds). Safe to call from several jobs at once. */
    void ensureRunning() throws Exception {
        synchronized (lock) {
            if (isRunning()) { touch(); return; }
            String why = unsupportedReason();
            if (why != null) throw new IllegalStateException(why);
            if (!installed()) throw new IllegalStateException("Computer abhi setup nahi hua. App me 'Phone computer' kholo aur setup chalao.");
            if (diskFull) throw new IllegalStateException("Computer ki storage limit (" + diskLimitGB() + " GB) bhar gayi hai. 'Phone computer' me storage badhao ya computer reset karo.");
            long need = Math.min(ramLimitMB(), 1536);
            if (availRamMB() < need) {
                throw new IllegalStateException("Phone me abhi sirf " + VenusLocalLogic.mb(availRamMB()) + " RAM khali hai (computer ko kam se kam " + VenusLocalLogic.mb(need)
                        + " chahiye). Local model ya baaki apps band karke dobara try karo.");
            }
            setState("starting", "Computer chalu ho raha hai…", -1);
            try {
                installGuestFiles();
                agentKey = newKey();
                File keyFile = new File(rootfs, "etc/venus-agent.key");
                try (OutputStream o = new FileOutputStream(keyFile)) { o.write(agentKey.getBytes(StandardCharsets.UTF_8)); }
                FS.chmod(keyFile, 0600);
                agentPort = freePort();
                Process p = prootBuilder("/bin/bash", "/usr/local/bin/venus-boot.sh", String.valueOf(agentPort)).start();
                proot = p;
                io.execute(() -> { // keep reading its output, otherwise the pipe fills up and the computer freezes
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = r.readLine()) != null) log(line);
                    } catch (IOException ignored) { }
                });
                long until = System.currentTimeMillis() + START_TIMEOUT_MS;
                boolean ready = false;
                while (System.currentTimeMillis() < until) {
                    if (!p.isAlive()) throw new IOException("Computer chalu hote hi band ho gaya. Log: " + lastLog(4));
                    try {
                        String[] h = VenusLocalLogic.httpLocal(agentPort, "GET", "/health", agentKey, null, 2500);
                        if ("200".equals(h[0]) && h[1].contains("\"ready\": true")) { ready = true; break; }
                    } catch (IOException notYet) { /* still starting */ }
                    Thread.sleep(500);
                }
                if (!ready) throw new IOException("Computer samay par taiyar nahi hua.");
            } catch (Exception e) {
                killTree();
                setState("error", e.getMessage() == null ? e.toString() : e.getMessage(), -1);
                throw e;
            }
            touch();
            overCount = 0; ramWarned = false; peakRamMB = 0;
            setState("running", "Computer chal raha hai.", -1);
            startTicker();
            holdWake(true);
            VenusLocalService.sync(app, true, "Computer chal raha hai");
        }
    }

    void startAsync() { io.execute(() -> { try { ensureRunning(); } catch (Exception ignored) { } }); }

    private String lastLog(int n) {
        synchronized (logTail) {
            List<String> l = new ArrayList<>(logTail);
            return String.join(" | ", l.subList(Math.max(0, l.size() - n), l.size()));
        }
    }

    void stop() {
        synchronized (lock) {
            Process p = proot;
            if (p == null) { if ("running".equals(state) || "starting".equals(state) || "stopping".equals(state)) setState(installed() ? "ready" : "needs-setup", "", -1); return; }
            setState("stopping", "Computer band ho raha hai…", -1);
            try { if (agentPort != 0) VenusLocalLogic.httpLocal(agentPort, "POST", "/exec", agentKey, "{\"cmd\":\"pkill -f chromium; sync\",\"timeoutMs\":3000}", 3500); } catch (Exception ignored) { }
            killTree();
            stopTicker();
            holdWake(false);
            usedRamMB = 0;
            VenusLocalService.sync(app, false, "");
            setState(installed() ? "ready" : "needs-setup", "Computer band hai, RAM wapas mil gayi.", -1);
        }
    }

    /** Ends the computer and everything it started. Nothing of it stays in memory. */
    private void killTree() {
        Process p = proot;
        proot = null;
        try {
            Map<Integer, Integer> parent = processTable();
            Set<Integer> mine = VenusLocalLogic.descendants(parent, android.os.Process.myPid());
            mine.remove(android.os.Process.myPid());
            if (p != null) p.destroy();
            Thread.sleep(300);
            for (int pid : mine) android.os.Process.killProcess(pid);
        } catch (Exception ignored) { }
        if (p != null) p.destroyForcibly();
        agentPort = 0;
    }

    // ------------------------------------------------------------------ watching: RAM, storage, idle

    void touch() { lastActivity = System.currentTimeMillis(); }

    private Map<Integer, Integer> processTable() {
        Map<Integer, Integer> parent = new HashMap<>();
        File[] list = new File("/proc").listFiles();
        if (list == null) return parent;
        for (File f : list) {
            String n = f.getName();
            if (n.isEmpty() || n.charAt(0) < '0' || n.charAt(0) > '9') continue;
            String stat = readLine(new File(f, "stat"));
            int[] st = VenusLocalLogic.parseStat(stat);
            if (st != null) parent.put(st[0], st[1]);
        }
        return parent;
    }

    private static String readLine(File f) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) { return r.readLine(); }
        catch (IOException e) { return null; }
    }

    /** The memory the computer uses right now (all of its processes together), in MB. */
    long measureRamMB() {
        Map<Integer, Integer> parent = processTable();
        int me = android.os.Process.myPid();
        Set<Integer> mine = VenusLocalLogic.descendants(parent, me);
        mine.remove(me);
        long bytes = 0;
        for (int pid : mine) bytes += VenusLocalLogic.residentBytes(readLine(new File("/proc/" + pid + "/statm")), 4096);
        return bytes / 1048576L;
    }

    private synchronized void startTicker() {
        if (ticker != null) return;
        ticker = Executors.newSingleThreadScheduledExecutor();
        ticker.scheduleWithFixedDelay(this::tick, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS);
    }

    private synchronized void stopTicker() {
        if (ticker != null) { ticker.shutdown(); ticker = null; } // not shutdownNow(): tick() itself may call stop(), and must not interrupt itself
    }

    private void tick() {
        try {
            Process p = proot;
            if (p == null) return;
            if (!p.isAlive()) { // it ended by itself (or the phone killed it)
                log("The computer stopped by itself.");
                killTree();
                stopTicker();
                holdWake(false);
                VenusLocalService.sync(app, false, "");
                setState(installed() ? "ready" : "needs-setup", "Computer band ho gaya.", -1);
                return;
            }
            long used = measureRamMB();
            usedRamMB = used;
            if (used > peakRamMB) peakRamMB = used;
            long limit = ramLimitMB();
            long now = System.currentTimeMillis();
            if (used > limit) {
                overCount++;
                ramWarned = true;
                if (overCount == 1 || now - lastRamAction > 15_000) {
                    lastRamAction = now;
                    log("RAM limit (" + VenusLocalLogic.mb(limit) + ") cross hui, Chrome band kiya.");
                    try { VenusLocalLogic.httpLocal(agentPort, "POST", "/exec", agentKey, "{\"cmd\":\"pkill -f chromium\",\"timeoutMs\":3000}", 3500); } catch (Exception ignored) { }
                }
                if (overCount >= 4 && used > limit * 12 / 10) { // Chrome was closed and it is still far over: stop everything
                    setState("error", "RAM limit (" + VenusLocalLogic.mb(limit) + ") cross ho gayi, isliye computer band kar diya. Settings me RAM badha sakte ho.", -1);
                    stop();
                    setState("error", "RAM limit (" + VenusLocalLogic.mb(limit) + ") cross ho gayi, isliye computer band kar diya. Settings me RAM badha sakte ho.", -1);
                    return;
                }
            } else {
                overCount = 0;
            }
            refreshDiskAsync();
            if (diskFull && now - lastRamAction > 60_000) { // clean the caches once
                lastRamAction = now;
                try { VenusLocalLogic.httpLocal(agentPort, "POST", "/exec", agentKey, "{\"cmd\":\"apk cache clean; rm -rf /root/.cache /home/user/.cache /tmp/* 2>/dev/null; true\",\"timeoutMs\":20000}", 25000); } catch (Exception ignored) { }
                diskAt = 0;
            }
            if (busy.get() == 0 && now - lastActivity > idleMinutes() * 60_000L) {
                log("Kaam nahi aaya, computer band kar raha hu (RAM wapas).");
                stop();
                return;
            }
            holdWake(true);
        } catch (Throwable ignored) { /* the watcher must never die */ }
    }

    private void holdWake(boolean on) {
        try {
            if (on) {
                if (wake == null) wake = ((PowerManager) app.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "venus:computer");
                wake.acquire(3 * 60_000L); // renewed every few seconds while the computer runs; never held longer than 3 minutes without it
            } else if (wake != null && wake.isHeld()) {
                wake.release();
            }
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ jobs

    /** Runs one job from the server in the computer and returns what the server expects back. */
    JSONObject runJob(String op, JSONObject a) throws Exception {
        if ("vm".equals(op)) {
            String action = a == null ? "status" : a.optString("action", "status");
            if ("start".equals(action)) startAsync();
            if ("stop".equals(action)) stop();
            return new JSONObject().put("stdout", state).put("exitCode", 0);
        }
        ensureRunning();
        if (diskFull) throw new IllegalStateException("Computer ki storage limit (" + diskLimitGB() + " GB) bhar gayi hai. 'Phone computer' me storage badhao ya computer reset karo.");
        busy.incrementAndGet();
        touch();
        try {
            String[] r;
            if ("exec".equals(op)) {
                int t = a.optInt("timeoutMs", 30_000);
                JSONObject body = new JSONObject().put("cmd", a.optString("cmd", "")).put("timeoutMs", t);
                r = VenusLocalLogic.httpLocal(agentPort, "POST", "/exec", agentKey, body.toString(), Math.min(300_000, t + 5_000));
            } else if ("screenshot".equals(op)) {
                r = VenusLocalLogic.httpLocal(agentPort, "POST", "/screenshot", agentKey, "{}", 25_000);
            } else {
                r = VenusLocalLogic.httpLocal(agentPort, "POST", "/input", agentKey, a.toString(), 30_000);
            }
            JSONObject j = new JSONObject(r[1].isEmpty() ? "{}" : r[1]);
            if (!"200".equals(r[0])) throw new IOException(j.optString("error", "computer error " + r[0]));
            return j;
        } finally {
            busy.decrementAndGet();
            touch();
        }
    }
}
