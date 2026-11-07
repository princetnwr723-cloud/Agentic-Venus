"use strict";
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { checkHost, qemuBinary, INSTALL_HELP } = require("./qemu-args");

function freeDiskGB(dir) {
  try { const s = fs.statfsSync(dir); return (s.bavail * s.bsize) / 1024 ** 3; } catch { return undefined; }
}
const has = (bin) => { try { return spawnSync(bin, ["--version"], { timeout: 8000 }).status === 0; } catch { return false; } };

/** Can this PC run the local computer? Also tells the user exactly what is missing. */
function inspect(dataDir) {
  const info = { platform: process.platform, arch: process.arch, totalMemMB: Math.round(os.totalmem() / 1048576), cpus: os.cpus().length, freeDiskGB: freeDiskGB(dataDir) };
  const r = checkHost(info);
  const bin = qemuBinary(info.arch);
  const missing = [];
  if (bin && !has(bin)) missing.push(`${bin} is not installed. ${INSTALL_HELP[info.platform] || ""}`);
  if (bin && !has("qemu-img")) missing.push(`qemu-img is not installed. ${INSTALL_HELP[info.platform] || ""}`);
  return { ...r, info, qemu: bin, missing, ready: r.ok && missing.length === 0 };
}

module.exports = { inspect };