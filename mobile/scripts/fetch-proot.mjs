// Run after `npx cap add android` and BEFORE prepare-android.mjs (the workflow does it).
// Puts the "proot" engine of the phone computer into the Android project as native libraries (android/app/src/main/jniLibs/arm64-v8a).
// Why there: Android lets an app run programs only from its own native-library folder, never from files it downloaded later.
//
// Where proot comes from: the Termux project's official package repository (the same proot that thousands of phones already run).
// Every file is checked against the sha256 in the repository index before it is used.
// Needs on the machine: node 18+, `ar`, `tar` with xz, and `patchelf` (the workflow installs them).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "android", "app", "src", "main", "jniLibs", "arm64-v8a");
const REPOS = ["https://packages.termux.dev/apt/termux-main", "https://packages-cf.termux.dev/apt/termux-main"];
const SKIP = /^(termux-|libandroid-support$|libc\+\+$|ca-certificates$|apt$|dpkg$)/; // things proot does not really need on Android

const die = (m) => { console.error("fetch-proot: " + m); process.exit(1); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function firstOk(paths) {
  let last = "";
  for (const base of REPOS) {
    for (const p of paths) {
      try { return { base, name: p, data: await get(`${base}/${p}`) }; } catch (e) { last = String(e.message || e); }
    }
  }
  throw new Error(last || "no repository answered");
}

function parseIndex(text) {
  const pkgs = new Map();
  for (const block of text.split(/\n\s*\n/)) {
    const f = {};
    let key = "";
    for (const line of block.split("\n")) {
      if (/^\s/.test(line)) { if (key) f[key] += "\n" + line.trim(); continue; }
      const i = line.indexOf(":");
      if (i < 0) continue;
      key = line.slice(0, i);
      f[key] = line.slice(i + 1).trim();
    }
    if (f.Package && f.Filename && f.SHA256) pkgs.set(f.Package, f);
  }
  return pkgs;
}

const depsOf = (p) => String(p.Depends || "").split(",").map((d) => d.split("|")[0].replace(/\(.*\)/, "").trim()).filter(Boolean);

function closure(pkgs, start) {
  const seen = new Set();
  const todo = [start];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n) || SKIP.test(n)) continue;
    const p = pkgs.get(n);
    if (!p) { console.warn(`fetch-proot: dependency "${n}" is not in the repository, continuing without it`); continue; }
    seen.add(n);
    for (const d of depsOf(p)) todo.push(d);
  }
  return [...seen];
}

function isArm64Elf(file) {
  const b = fs.readFileSync(file);
  return b.length > 20 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 && b[18] === 0xb7;
}

function find(dir, test, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) find(p, test, acc);
    else if (test(p, e)) acc.push(p);
  }
  return acc;
}

async function main() {
  if (!fs.existsSync(path.join(root, "android"))) die("android/ folder not found. Run `npx cap add android` first.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "venus-proot-"));

  // 1. the repository index
  let text = "";
  let base = "";
  try {
    const idx = await firstOk(["dists/stable/main/binary-aarch64/Packages", "dists/stable/main/binary-aarch64/Packages.gz"]);
    text = idx.name.endsWith(".gz") ? zlib.gunzipSync(idx.data).toString("utf8") : idx.data.toString("utf8");
    base = idx.base;
  } catch (e) { die("could not read the Termux package list: " + e.message); }
  const pkgs = parseIndex(text);
  if (!pkgs.has("proot")) die('the Termux package list has no "proot".');

  // 2. download and unpack proot and what it needs
  const names = closure(pkgs, "proot");
  console.log("fetch-proot: packages:", names.map((n) => `${n} ${pkgs.get(n).Version}`).join(", "));
  const data = path.join(tmp, "data");
  fs.mkdirSync(data);
  for (const n of names) {
    const p = pkgs.get(n);
    const buf = await get(`${base}/${p.Filename}`);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha !== p.SHA256.toLowerCase()) die(`${n}: the download does not match its checksum.`);
    const deb = path.join(tmp, n + ".deb");
    fs.writeFileSync(deb, buf);
    const dd = path.join(tmp, "x-" + n);
    fs.mkdirSync(dd);
    sh("ar", ["x", deb], { cwd: dd });
    const tarball = fs.readdirSync(dd).find((f) => f.startsWith("data.tar"));
    if (!tarball) die(`${n}: no data inside the package.`);
    sh("tar", ["-xf", path.join(dd, tarball), "-C", data]);
  }

  const usr = find(data, (p) => p.endsWith(path.join("files", "usr", "bin", "proot")))[0];
  if (!usr) die("proot binary not found in the package.");
  const prefix = path.resolve(usr, "..", "..");
  const proot = path.join(prefix, "bin", "proot");
  const loader = [path.join(prefix, "libexec", "proot", "loader")].find((f) => fs.existsSync(f));
  const loader32 = path.join(prefix, "libexec", "proot", "loader32");
  if (!loader) die("proot loader not found in the package.");
  if (!isArm64Elf(proot) || !isArm64Elf(loader)) die("the files are not for 64-bit ARM.");

  // 3. the libraries proot needs. Android only packs files named lib*.so, so a library such as libtalloc.so.2 gets a new
  //    name and proot is told about it (patchelf --replace-needed).
  fs.mkdirSync(out, { recursive: true });
  const libDir = path.join(prefix, "lib");
  const libs = fs.existsSync(libDir) ? find(libDir, (p) => /\.so(\.\d+)*$/.test(p) && !fs.lstatSync(p).isSymbolicLink() && isArm64Elf(p)) : [];
  const rename = new Map(); // soname -> new file name
  for (const f of libs) {
    let soname = path.basename(f);
    try { soname = sh("patchelf", ["--print-soname", f]).trim() || soname; } catch { /* no soname: use the file name */ }
    const fresh = "lib" + soname.replace(/^lib/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "") + ".so";
    const dest = path.join(out, fresh);
    fs.copyFileSync(f, dest);
    rename.set(soname, fresh);
    rename.set(path.basename(f), fresh);
  }

  const place = (src, name) => { const d = path.join(out, name); fs.copyFileSync(src, d); fs.chmodSync(d, 0o755); return d; };
  place(proot, "libproot.so");
  place(loader, "libproot-loader.so");
  if (fs.existsSync(loader32)) { try { place(loader32, "libproot-loader32.so"); } catch { /* optional */ } }
  const elfs = [path.join(out, "libproot.so"), ...libs.map((f) => path.join(out, rename.get(path.basename(f))))];
  for (const e of elfs) {
    let needed = [];
    try { needed = sh("patchelf", ["--print-needed", e]).split("\n").map((s) => s.trim()).filter(Boolean); } catch (err) { die("patchelf is needed: " + err.message); }
    for (const n of needed) if (rename.has(n)) sh("patchelf", ["--replace-needed", n, rename.get(n), e]);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("fetch-proot: ready:", fs.readdirSync(out).join(", "));
}

main().catch((e) => die(String(e && e.message ? e.message : e)));
