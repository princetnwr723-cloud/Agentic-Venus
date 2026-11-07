"use strict";
// Pure functions (no Electron, no disk): decide whether this PC can run the local computer, and how to start it.

const GUEST_PORT = 7077;
const MIN = { memMB: 8 * 1024, cpus: 4, freeDiskGB: 25 };

function guestArch(arch) {
  if (arch === "x64") return "x86_64";
  if (arch === "arm64") return "aarch64";
  return null;
}
const qemuBinary = (arch) => { const g = guestArch(arch); return g ? `qemu-system-${g}` : null; };

function accelFor(platform) {
  if (platform === "linux") return "kvm";
  if (platform === "darwin") return "hvf";
  if (platform === "win32") return "whpx";
  return null;
}

/** What the VM gets, based on the PC: 3 GB (6 GB on a 16 GB+ PC), 2 CPUs (4 on an 8+ core PC), 15 GB growing disk. */
function sizeVm(info) {
  return {
    memMB: info.totalMemMB >= 16 * 1024 ? 6 * 1024 : 3 * 1024,
    cpus: info.cpus >= 8 ? 4 : 2,
    diskGB: 15,
  };
}

function checkHost(info) {
  const problems = [];
  if (!guestArch(info.arch)) problems.push(`This CPU (${info.arch}) is not supported yet. You need a 64-bit Intel/AMD PC or an Apple silicon Mac.`);
  if (!accelFor(info.platform)) problems.push(`This operating system (${info.platform}) is not supported.`);
  if (info.platform === "win32" && info.arch === "arm64") problems.push("Windows on ARM is not supported yet.");
  if (info.totalMemMB < MIN.memMB) problems.push(`At least 8 GB RAM is needed (this PC has ${Math.round(info.totalMemMB / 1024)} GB).`);
  if (info.cpus < MIN.cpus) problems.push(`At least 4 CPU cores are needed (this PC has ${info.cpus}).`);
  if (info.freeDiskGB !== undefined && info.freeDiskGB < MIN.freeDiskGB) problems.push(`At least 25 GB free disk space is needed (${Math.floor(info.freeDiskGB)} GB free).`);
  return { ok: problems.length === 0, problems, vm: sizeVm(info) };
}

const INSTALL_HELP = {
  win32: "Install QEMU: winget install SoftwareFreedomConservancy.QEMU   (and turn on 'Windows Hypervisor Platform' in Windows Features).",
  darwin: "Install QEMU: brew install qemu",
  linux: "Install QEMU: sudo apt install qemu-system-x86 qemu-utils   (and make sure your user is in the 'kvm' group).",
};

/** Arguments for qemu-system-*. Only 127.0.0.1 of this PC can reach the VM (one forwarded port, one secret key). */
function buildQemuArgs(o) {
  const g = guestArch(o.arch);
  const accel = accelFor(o.platform);
  if (!g || !accel) throw new Error("Unsupported PC.");
  const a = ["-name", "AgenticVenus-computer", "-m", String(o.memMB), "-smp", String(o.cpus)];
  if (g === "x86_64") {
    a.push("-machine", "q35", "-accel", accel === "whpx" ? "whpx,kernel-irqchip=off" : accel, "-cpu", accel === "whpx" ? "qemu64" : "host", "-vga", "virtio");
  } else {
    if (!o.firmware) throw new Error("The UEFI firmware file for ARM is missing.");
    a.push("-machine", "virt,highmem=on", "-accel", accel, "-cpu", "host", "-bios", o.firmware, "-device", "virtio-gpu-pci");
  }
  a.push("-device", "qemu-xhci", "-device", "usb-kbd", "-device", "usb-tablet");
  a.push("-drive", `file=${o.diskPath},if=virtio,format=qcow2,cache=writeback`);
  a.push("-nic", `user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:${o.agentPort}-:${GUEST_PORT}`);
  if (o.seedPort) a.push("-smbios", `type=1,serial=ds=nocloud;s=http://10.0.2.2:${o.seedPort}/`);
  a.push("-display", o.headless ? "none" : o.platform === "darwin" ? "cocoa" : "gtk");
  return a;
}

module.exports = { GUEST_PORT, MIN, guestArch, qemuBinary, accelFor, sizeVm, checkHost, buildQemuArgs, INSTALL_HELP };