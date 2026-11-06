// APP_URL = your deployed website, e.g. https://your-app.vercel.app (no slash at the end).
const url = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
if (!url) throw new Error("Set APP_URL (your website address) before building the app.");

module.exports = {
  appId: "com.agenticvenus.app",
  appName: "Agentic Venus",
  webDir: "www",
  backgroundColor: "#0a0a0b",
  server: {
    url: url + "/app-login",
    androidScheme: "https",
    allowNavigation: [new URL(url).hostname],
  },
  android: {
    allowMixedContent: false,
    // Android 15+ draws apps edge-to-edge: keep the page clear of the status bar and the gesture bar
    adjustMarginsForEdgeToEdge: "force",
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};