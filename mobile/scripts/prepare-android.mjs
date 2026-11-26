// Run once after `npx cap add android` (the workflow does it). Adds what the plugins and Firebase need to the Android project,
// and installs the native scheduler (mobile/native/android/*.java): exact alarms that run your routines on the phone, on time,
// and the phone computer (a small Linux with Chrome and a terminal: VenusLocal*.java + the guest scripts, see mobile/native/guest).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = path.join(root, "android", "app", "src", "main");
const manifestPath = path.join(main, "AndroidManifest.xml");
const PKG = "com.agenticvenus.app";

if (!fs.existsSync(manifestPath)) {
  console.error("android/ folder not found. Run `npx cap add android` first.");
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, "utf8");

// 1. permissions
const PERMS = [
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.WAKE_LOCK",
  "android.permission.ACCESS_NETWORK_STATE", // the phone computer sets itself up on Wi-Fi, so it must know whether the network is metered
  // scheduler: exact alarms, come back after a reboot, and ask to be exempt from battery saving
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
];
for (const p of PERMS) {
  if (!xml.includes(p)) xml = xml.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
}

// 2. runner service + push defaults + scheduler receivers
const APP_BLOCK = `
        <service android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService" android:foregroundServiceType="dataSync" android:exported="false" />
        <receiver android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver" android:exported="false" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_venus" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="venus_alerts" />
`;
if (!xml.includes("AndroidForegroundService")) xml = xml.replace("</application>", APP_BLOCK + "    </application>");

const SCHED_BLOCK = `
        <receiver android:name=".VenusAlarmReceiver" android:exported="false" />
        <receiver android:name=".VenusBootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
            </intent-filter>
        </receiver>
`;
if (!xml.includes(".VenusAlarmReceiver")) xml = xml.replace("</application>", SCHED_BLOCK + "    </application>");

const LOCAL_BLOCK = `
        <service android:name=".VenusLocalService" android:foregroundServiceType="dataSync" android:exported="false" />
`;
if (!xml.includes(".VenusLocalService")) xml = xml.replace("</application>", LOCAL_BLOCK + "    </application>");

// 3. the login link agenticvenus://auth?code=...
const FILTER = `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="agenticvenus" android:host="auth" />
            </intent-filter>
`;
if (!xml.includes('android:scheme="agenticvenus"')) xml = xml.replace("</activity>", FILTER + "        </activity>");

fs.writeFileSync(manifestPath, xml);

// 4. the small white notification icon
const drawable = path.join(main, "res", "drawable");
fs.mkdirSync(drawable, { recursive: true });
fs.writeFileSync(
  path.join(drawable, "ic_stat_venus.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,2 L14.4,9.6 L22,12 L14.4,14.4 L12,22 L9.6,14.4 L2,12 L9.6,9.6 Z" />
</vector>
`
);

// 5. the native scheduler: copy the Java files next to MainActivity and register the plugin
const javaDir = path.join(main, "java", ...PKG.split("."));
fs.mkdirSync(javaDir, { recursive: true });
const srcDir = path.join(root, "native", "android");
for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith(".java"))) {
  fs.copyFileSync(path.join(srcDir, f), path.join(javaDir, f));
}
fs.writeFileSync(
  path.join(javaDir, "MainActivity.java"),
  `package ${PKG};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VenusSchedulerPlugin.class);
        registerPlugin(VenusLocalPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`
);

// 6. the phone computer: the scripts that run INSIDE it (one agent file is shared with the desktop app)
const assets = path.join(main, "assets", "venus");
fs.mkdirSync(assets, { recursive: true });
const guest = path.join(root, "native", "guest");
for (const f of fs.readdirSync(guest)) fs.copyFileSync(path.join(guest, f), path.join(assets, f));
const agent = path.resolve(root, "..", "desktop", "vm-agent", "venus-agent.py");
if (fs.existsSync(agent)) fs.copyFileSync(agent, path.join(assets, "venus-agent.py"));
else console.warn("WARNING: desktop/vm-agent/venus-agent.py not found: the phone computer will not work.");

// 7. proot is started from the app's native-library folder (Android does not let an app run files it downloaded),
//    so that folder must hold real files: "legacy packaging" keeps them unpacked.
const gradlePath = path.join(root, "android", "app", "build.gradle");
if (fs.existsSync(gradlePath)) {
  let g = fs.readFileSync(gradlePath, "utf8");
  if (!g.includes("useLegacyPackaging")) {
    g = g.replace(/^android\s*\{/m, "android {\n    packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }");
    fs.writeFileSync(gradlePath, g);
  }
}
const proot = path.join(main, "jniLibs", "arm64-v8a", "libproot.so");
if (!fs.existsSync(proot)) console.warn("WARNING: libproot.so is missing (run `node scripts/fetch-proot.mjs` first). The app builds, but the phone computer will say it is not in this build.");

if (!fs.existsSync(path.join(root, "android", "app", "google-services.json"))) {
  console.warn("WARNING: android/app/google-services.json is missing, push notifications will not work.");
}
console.log("Android project prepared (scheduler and phone computer installed).");
