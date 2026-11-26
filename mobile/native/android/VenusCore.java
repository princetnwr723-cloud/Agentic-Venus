package com.agenticvenus.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Everything the phone does for schedules, without the WebView (so it works when the app is closed):
 *  - keeps the login (a Firebase refresh token) encrypted with an Android Keystore key
 *  - asks the server "/api/device/plan" when to wake up, and arms one exact alarm per time
 *  - when an alarm fires it calls "/api/device/run": the server claims the routine with the same lease the cloud scheduler uses,
 *    so the phone and the server can never run one occurrence twice. If the phone is off or offline the server scheduler runs it later.
 */
public final class VenusCore {
    private VenusCore() {}

    static final String PREFS = "venus_sched";
    static final String ACT_FIRE = "com.agenticvenus.app.FIRE";
    static final String ACT_SYNC = "com.agenticvenus.app.SYNC";
    static final String ACT_TEST = "com.agenticvenus.app.TEST";
    static final String CH_RUNS = "venus_runs";
    private static final String KEY_ALIAS = "venus_sched_key";
    private static final long SAFETY_MS = 25 * 60_000L; // a refresh even if nothing else wakes the app
    private static final int MAX_ATTEMPTS = 5;
    private static final Object LOCK = new Object();

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    // ------------------------------------------------------------ secrets (Android Keystore, AES-GCM)
    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            g.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            return g.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    static String seal(String plain) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception e) { return null; }
    }

    static String open(String sealed) {
        if (sealed == null) return null;
        try {
            String[] p = sealed.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) { return null; }
    }

    // ------------------------------------------------------------ setup
    static void configure(Context ctx, String appUrl, String apiKey, String refreshToken) {
        String sealed = seal(refreshToken);
        if (sealed == null) return;
        prefs(ctx).edit()
                .putString("appUrl", appUrl.replaceAll("/+$", ""))
                .putString("apiKey", apiKey)
                .putString("rt", sealed)
                .remove("idt").putLong("idt_exp", 0)
                .apply();
    }

    static boolean configured(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return p.getString("rt", null) != null && p.getString("apiKey", null) != null && p.getString("appUrl", null) != null;
    }

    /** Logout: forget the login and every alarm. */
    static void clear(Context ctx) {
        synchronized (LOCK) {
            cancelAll(ctx);
            prefs(ctx).edit().clear().apply();
        }
    }

    // ------------------------------------------------------------ HTTP with a fresh login token
    static final class Res { int code; String body = ""; }

    private static synchronized String idToken(Context ctx, boolean force) throws Exception {
        SharedPreferences p = prefs(ctx);
        String cached = open(p.getString("idt", null));
        if (!force && cached != null && System.currentTimeMillis() < p.getLong("idt_exp", 0) - 60_000) return cached;
        String rt = open(p.getString("rt", null));
        String apiKey = p.getString("apiKey", null);
        if (rt == null || apiKey == null) throw new IllegalStateException("not configured");
        HttpURLConnection c = (HttpURLConnection) new URL("https://securetoken.googleapis.com/v1/token?key=" + URLEncoder.encode(apiKey, "UTF-8")).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(10000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        byte[] body = ("grant_type=refresh_token&refresh_token=" + URLEncoder.encode(rt, "UTF-8")).getBytes(StandardCharsets.UTF_8);
        try (OutputStream o = c.getOutputStream()) { o.write(body); }
        int code = c.getResponseCode();
        String txt = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
        c.disconnect();
        if (code != 200) {
            // the login really is gone (password changed, account removed): stop trying, the app asks to sign in again
            if (code == 400 || code == 401) p.edit().putBoolean("authLost", true).apply();
            throw new IOException("token " + code);
        }
        JSONObject j = new JSONObject(txt);
        String id = j.getString("id_token");
        long ttl = Long.parseLong(j.optString("expires_in", "3600")) * 1000L;
        SharedPreferences.Editor e = p.edit().putString("idt", seal(id)).putLong("idt_exp", System.currentTimeMillis() + ttl).putBoolean("authLost", false);
        String newRt = j.optString("refresh_token", "");
        if (!newRt.isEmpty()) e.putString("rt", seal(newRt));
        e.apply();
        return id;
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    static Res api(Context ctx, String method, String path, String json) throws Exception {
        return api(ctx, method, path, json, 12000);
    }

    /** Same call with its own read timeout: the phone computer waits up to ~20 s for work on "/api/local" (long polling). */
    static Res api(Context ctx, String method, String path, String json, int readTimeoutMs) throws Exception {
        for (int pass = 0; pass < 2; pass++) {
            String token = idToken(ctx, pass == 1);
            HttpURLConnection c = (HttpURLConnection) new URL(prefs(ctx).getString("appUrl", "") + path).openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(readTimeoutMs);
            c.setRequestMethod(method);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", "application/json");
            if (json != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream o = c.getOutputStream()) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
            }
            Res r = new Res();
            r.code = c.getResponseCode();
            r.body = read(r.code >= 400 ? c.getErrorStream() : c.getInputStream());
            c.disconnect();
            if (r.code == 401 && pass == 0) continue; // the token may just have expired: get a new one and try once more
            return r;
        }
        throw new IOException("unauthorized");
    }

    // ------------------------------------------------------------ alarms
    private static AlarmManager alarms(Context ctx) { return (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE); }

    static boolean canExact(Context ctx) {
        return Build.VERSION.SDK_INT < 31 || alarms(ctx).canScheduleExactAlarms();
    }

    private static PendingIntent pi(Context ctx, String action, String path, String id, long at, String name, int attempt, int flags) {
        Intent i = new Intent(ctx, VenusAlarmReceiver.class).setAction(action).setData(Uri.parse("venus://" + path));
        i.putExtra("id", id).putExtra("at", at).putExtra("name", name).putExtra("attempt", attempt);
        return PendingIntent.getBroadcast(ctx, 0, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void arm(Context ctx, PendingIntent p, long at, boolean exact) {
        AlarmManager am = alarms(ctx);
        long when = Math.max(at, System.currentTimeMillis() + 1000);
        try {
            if (exact && canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, p);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, p);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, p);
        }
    }

    private static void cancelAll(Context ctx) {
        AlarmManager am = alarms(ctx);
        try {
            JSONArray old = new JSONArray(prefs(ctx).getString("plan", "[]"));
            for (int k = 0; k < old.length(); k++) {
                JSONObject o = old.getJSONObject(k);
                PendingIntent p = pi(ctx, ACT_FIRE, "fire/" + o.getString("id") + "/" + o.getLong("at"), "", 0, "", 0, PendingIntent.FLAG_NO_CREATE);
                if (p != null) am.cancel(p);
            }
        } catch (Exception ignored) { }
        PendingIntent s = pi(ctx, ACT_SYNC, "sync", "", 0, "", 0, PendingIntent.FLAG_NO_CREATE);
        if (s != null) am.cancel(s);
    }

    /** Asks the server for the wake-up times and arms them. Returns how many alarms are armed. */
    static int syncPlan(Context ctx) throws Exception {
        if (!configured(ctx)) return 0;
        SharedPreferences p = prefs(ctx);
        StringBuilder q = new StringBuilder("/api/device/plan?v=2&n=" + URLEncoder.encode(Build.MANUFACTURER + " " + Build.MODEL, "UTF-8"));
        long lf = p.getLong("unrepAt", 0);
        if (lf > 0) q.append("&lf=").append(lf).append("&ls=").append(URLEncoder.encode(p.getString("unrepStatus", ""), "UTF-8")).append("&ll=").append(p.getLong("unrepLate", 0));
        Res r = api(ctx, "GET", q.toString(), null);
        if (r.code != 200) throw new IOException("plan " + r.code);
        JSONArray items = new JSONObject(r.body).getJSONArray("items");
        synchronized (LOCK) {
            cancelAll(ctx);
            JSONArray kept = new JSONArray();
            for (int k = 0; k < items.length(); k++) {
                JSONObject o = items.getJSONObject(k);
                String id = o.getString("id");
                long at = o.getLong("at");
                arm(ctx, pi(ctx, ACT_FIRE, "fire/" + id + "/" + at, id, at, o.optString("name", "Routine"), 0, PendingIntent.FLAG_UPDATE_CURRENT), at, true);
                kept.put(new JSONObject().put("id", id).put("at", at).put("name", o.optString("name", "Routine")));
            }
            arm(ctx, pi(ctx, ACT_SYNC, "sync", "", 0, "", 0, PendingIntent.FLAG_UPDATE_CURRENT), System.currentTimeMillis() + SAFETY_MS, false);
            p.edit().putString("plan", kept.toString()).putLong("lastSync", System.currentTimeMillis()).remove("unrepAt").apply();
            return kept.length();
        }
    }

    // ------------------------------------------------------------ what an alarm does
    /** One broadcast = one short network call (a broadcast only has a few seconds). */
    static void handle(Context ctx, String action, String id, long at, String name, int attempt) {
        long now = System.currentTimeMillis();
        if (ACT_TEST.equals(action)) {
            record(ctx, "Test alarm", "ok", Math.max(0, now - at), at);
            notify(ctx, "Test alarm worked ✅", "Your phone woke up " + Math.max(0, (now - at) / 1000) + "s after the set time. Schedules will run on time.", 9001);
            return;
        }
        if (!configured(ctx)) return;
        if (ACT_SYNC.equals(action)) {
            try { syncPlan(ctx); } catch (Exception e) { arm(ctx, pi(ctx, ACT_SYNC, "sync", "", 0, "", 0, PendingIntent.FLAG_UPDATE_CURRENT), now + 5 * 60_000L, false); }
            return;
        }
        if (!ACT_FIRE.equals(action) || id == null || id.isEmpty()) return;

        String status;
        boolean retry = false;
        try {
            Res r = api(ctx, "POST", "/api/device/run", new JSONObject().put("id", id).toString());
            JSONObject j = new JSONObject(r.body.isEmpty() ? "{}" : r.body);
            status = r.code >= 500 ? "server " + r.code : r.code == 401 ? "login lost" : j.optString("status", "?");
            retry = r.code >= 500;
            if ("started".equals(status)) notify(ctx, "▶ " + name, "Your routine is running.", 7000 + (int) (Math.abs(id.hashCode()) % 900));
        } catch (Exception e) {
            status = "offline";
            retry = true; // no signal right now: try again in a minute (the cloud scheduler is the safety net if this never works)
        }
        if (retry && attempt < MAX_ATTEMPTS) {
            long when = now + 60_000L * (attempt + 1);
            arm(ctx, pi(ctx, ACT_FIRE, "retry/" + id + "/" + at + "/" + (attempt + 1), id, at, name, attempt + 1, PendingIntent.FLAG_UPDATE_CURRENT), when, true);
        }
        record(ctx, name, status, Math.max(0, now - at), at);
        // refresh the plan in its own short broadcast a few seconds from now
        arm(ctx, pi(ctx, ACT_SYNC, "sync", "", 0, "", 0, PendingIntent.FLAG_UPDATE_CURRENT), now + 6_000L, false);
    }

    private static void record(Context ctx, String name, String status, long late, long at) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONArray log = new JSONArray(p.getString("log", "[]"));
            JSONArray next = new JSONArray();
            next.put(new JSONObject().put("t", System.currentTimeMillis()).put("name", name).put("status", status).put("lateMs", late));
            for (int k = 0; k < Math.min(log.length(), 19); k++) next.put(log.get(k));
            p.edit().putString("log", next.toString()).putLong("unrepAt", at).putString("unrepStatus", status).putLong("unrepLate", late).apply();
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------ test + status
    static void armTest(Context ctx, int seconds) {
        long at = System.currentTimeMillis() + seconds * 1000L;
        arm(ctx, pi(ctx, ACT_TEST, "test", "", at, "Test", 0, PendingIntent.FLAG_UPDATE_CURRENT), at, true);
    }

    static void notify(Context ctx, String title, String text, int id) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH_RUNS) == null) {
                nm.createNotificationChannel(new NotificationChannel(CH_RUNS, "Routine runs", NotificationManager.IMPORTANCE_DEFAULT));
            }
            int icon = ctx.getResources().getIdentifier("ic_stat_venus", "drawable", ctx.getPackageName());
            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent tap = launch == null ? null : PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_RUNS)
                    .setSmallIcon(icon != 0 ? icon : android.R.drawable.ic_popup_reminder)
                    .setContentTitle(title).setContentText(text).setAutoCancel(true).setTimeoutAfter(45_000)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT).setContentIntent(tap);
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (Exception ignored) { }
    }

    static boolean needsAutostartHelp() {
        String m = Build.MANUFACTURER.toLowerCase();
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") || m.contains("oppo") || m.contains("realme") || m.contains("vivo")
                || m.contains("iqoo") || m.contains("huawei") || m.contains("honor") || m.contains("oneplus") || m.contains("samsung") || m.contains("asus") || m.contains("tecno") || m.contains("infinix");
    }

    static JSONObject status(Context ctx) throws Exception {
        SharedPreferences p = prefs(ctx);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        JSONArray plan = new JSONArray(p.getString("plan", "[]"));
        long next = 0;
        long now = System.currentTimeMillis();
        for (int k = 0; k < plan.length(); k++) {
            long at = plan.getJSONObject(k).getLong("at");
            if (at > now && (next == 0 || at < next)) next = at;
        }
        return new JSONObject()
                .put("platform", "android")
                .put("configured", configured(ctx))
                .put("authLost", p.getBoolean("authLost", false))
                .put("exactAlarm", canExact(ctx))
                .put("batteryUnrestricted", Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(ctx.getPackageName()))
                .put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
                .put("needsAutostart", needsAutostartHelp())
                .put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT)
                .put("armed", plan.length()).put("nextAt", next)
                .put("lastSync", p.getLong("lastSync", 0))
                .put("log", new JSONArray(p.getString("log", "[]")));
    }
}
