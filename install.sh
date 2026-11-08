#!/bin/sh
# AgenticVenus desktop installer for Linux and macOS.
#   curl -fsSL https://raw.githubusercontent.com/princetnwr723-cloud/AgenticVenus/main/install.sh | sh
# It downloads the latest release for this PC, checks its SHA-256 checksum, and only then installs it.
set -eu

BASE="${VENUS_BASE:-https://github.com/princetnwr723-cloud/AgenticVenus/releases/latest/download}"

case "$(uname -s)" in
  Linux)  o=linux; ext=AppImage ;;
  Darwin) o=mac;   ext=dmg ;;
  *) echo "This script is for Linux and macOS. On Windows use install.ps1."; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  a=x64 ;;
  arm64|aarch64) a=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
esac

name="AgenticVenus-$o-$a.$ext"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

echo "Downloading $name ..."
curl -fsSL -o "$name" "$BASE/$name" || { echo "No installer is published for $o $a yet."; exit 1; }
curl -fsSL -o SHA256SUMS.txt "$BASE/SHA256SUMS.txt" || { echo "This release has no SHA256SUMS.txt, so it will not be installed."; exit 1; }

want="$(awk -v n="$name" '{f=$2; sub(/^\*/,"",f)} f==n {print $1}' SHA256SUMS.txt)"
if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$name" | awk '{print $1}')"; else got="$(shasum -a 256 "$name" | awk '{print $1}')"; fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  echo "Checksum mismatch: the download is damaged or was tampered with. Nothing was installed."
  exit 1
fi
echo "Checksum OK."

if [ "$o" = "linux" ]; then
  dest="${HOME}/.local/bin"
  mkdir -p "$dest"
  mv "$name" "$dest/agenticvenus-desktop"
  chmod +x "$dest/agenticvenus-desktop"
  echo "Installed: $dest/agenticvenus-desktop"
  [ -n "${VENUS_NO_LAUNCH:-}" ] || { nohup "$dest/agenticvenus-desktop" >/dev/null 2>&1 & }
else
  mv "$name" "$HOME/Downloads/$name"
  echo "Saved to ~/Downloads/$name. Opening it: drag AgenticVenus into Applications."
  [ -n "${VENUS_NO_LAUNCH:-}" ] || open "$HOME/Downloads/$name"
fi

cat <<'MSG'

For the local computer you also need QEMU:
  macOS:  brew install qemu
  Linux:  sudo apt install qemu-system-x86 qemu-utils
MSG