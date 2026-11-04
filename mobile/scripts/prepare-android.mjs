// Run once after `npx cap add android` (the workflow does it). Adds what the plugins and Firebase need to the Android project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = path.join(root, "android", "app", "src", "main");
const manifestPath = path.join(main, "AndroidManifest.xml");

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
];
for (const p of PERMS) {
  if (!xml.includes(p)) xml = xml.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
}

// 2. runner service + push defaults
const APP_BLOCK = `
        <service android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService" android:foregroundServiceType="dataSync" android:exported="false" />
        <receiver android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver" android:exported="false" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_venus" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="venus_alerts" />
`;
if (!xml.includes("AndroidForegroundService")) xml = xml.replace("</application>", APP_BLOCK + "    </application>");

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

if (!fs.existsSync(path.join(root, "android", "app", "google-services.json"))) {
  console.warn("WARNING: android/app/google-services.json is missing, push notifications will not work.");
}
console.log("Android project prepared.");