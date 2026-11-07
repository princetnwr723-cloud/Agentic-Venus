#!/usr/bin/env node
// `npx agenticvenus` : downloads the AgenticVenus desktop app for this PC, checks its checksum, and installs it.
import { createHash } from "node:crypto";
import { createWriteStream, chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir, platform as osPlatform, arch as osArch } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const REPO = "princetnwr723-cloud/AgenticVenus";
const OS = { win32: ["win", "exe"], darwin: ["mac", "dmg"], linux: ["linux", "AppImage"] };

/** Chooses the installer for this PC from a GitHub release's asset list. */
export function pickAsset(assets, platform, arch) {
  const os = OS[platform];
  if (!os || !["x64", "arm64"].includes(arch)) return null;
  const tail = `-${os[0]}-${arch}.${os[1]}`;
  return assets.find((a) => typeof a.name === "string" && a.name.startsWith("AgenticVenus-") && a.name.endsWith(tail)) || null;
}

export function sumFor(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1];
  }
  return null;
}

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "agenticvenus-cli", Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const rel = await (await get(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
  const asset = pickAsset(rel.assets || [], osPlatform(), osArch());
  if (!asset) throw new Error(`No AgenticVenus desktop app is published for ${osPlatform()} ${osArch()} yet.`);
  const sums = (rel.assets || []).find((a) => a.name === "SHA256SUMS.txt");
  if (!sums) throw new Error("This release has no SHA256SUMS.txt, so it will not be installed.");
  console.log(`AgenticVenus ${rel.tag_name}: ${asset.name}`);
  if (dry) return;

  const want = sumFor(await (await get(sums.browser_download_url)).text(), asset.name);
  if (!want) throw new Error("The checksum list does not contain this installer.");
  const out = join(tmpdir(), asset.name);
  const res = await get(asset.browser_download_url);
  const hash = createHash("sha256");
  const src = Readable.fromWeb(res.body);
  src.on("data", (c) => hash.update(c));
  await pipeline(src, createWriteStream(out));
  if (hash.digest("hex") !== want) { rmSync(out, { force: true }); throw new Error("Checksum mismatch: the download is damaged or was tampered with. Nothing was installed."); }
  console.log("Checksum OK.");

  if (osPlatform() === "win32") spawn(out, [], { detached: true, stdio: "ignore" }).unref();
  else if (osPlatform() === "darwin") spawn("open", [out], { detached: true, stdio: "ignore" }).unref();
  else {
    const dir = join(homedir(), ".local", "bin");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "agenticvenus-desktop");
    copyFileSync(out, dest);
    chmodSync(dest, 0o755);
    spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
    console.log(`Installed to ${dest}`);
  }
  console.log("\nFor the local computer you also need QEMU:\n  Windows: winget install SoftwareFreedomConservancy.QEMU\n  macOS:   brew install qemu\n  Linux:   sudo apt install qemu-system-x86 qemu-utils");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("Install failed: " + (e instanceof Error ? e.message : e)); process.exit(1); });
}