// Run once after `npx cap add ios` (the iOS workflow does it). Adds the login link agenticvenus://auth to the iPhone/iPad app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plistPath = path.join(root, "ios", "App", "App", "Info.plist");

if (!fs.existsSync(plistPath)) {
  console.error("ios/App/App/Info.plist not found. Run `npx cap add ios` first.");
  process.exit(1);
}

let plist = fs.readFileSync(plistPath, "utf8");

if (!plist.includes("<string>agenticvenus</string>")) {
  const urlTypes = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.agenticvenus.app</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>agenticvenus</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;
  if (plist.includes("<key>CFBundleURLTypes</key>")) {
    // the template already has a list: add our scheme as one more entry
    plist = plist.replace(
      "<key>CFBundleURLTypes</key>\n\t<array>",
      `<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>agenticvenus</string>\n\t\t\t</array>\n\t\t</dict>`
    );
  } else {
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, urlTypes + "</dict>\n</plist>\n");
  }
  fs.writeFileSync(plistPath, plist);
}
console.log("iOS project prepared (login link added).");
