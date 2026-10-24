// What is installed on every agent computer, and how the agent is told to use it.
import { REA_PC_PROMPT } from "@/lib/rea-policy";

// 8: the wait no longer matches the permanent unattended-upgrades daemon (it made setup wait forever).
// 7: setup is now serialized (waits for the computer's own first-boot installs), retries apt with fresh package lists,
// and falls back to the official Node.js tarball. Bumping the version re-runs setup on old computers.
export const PC_SETUP_VERSION = "8";

/**
 * Core tools install first (the computer is "ready" after this); the big desktop apps install in the background.
 * Design rules (these are what fixed "Can't find a source to download version ..." and "rename failed ... partial"):
 *  - only ONE apt process at a time: wait for provisioning / other apt runs before every apt call (max 3 minutes),
 *  - always install from freshly downloaded package lists, and retry with a refresh when a package cannot be found,
 *  - the core (git, curl, zip, Node 22) is mandatory, every optional tool is best-effort,
 *  - Node.js falls back to the official tarball when NodeSource or apt fails,
 *  - re-running the script is always safe (the server re-runs it automatically when it failed).
 */
export const pcSetupScript = (assets: string) => `export DEBIAN_FRONTEND=noninteractive
mkdir -p /tmp/jobs
step() { echo "== $*"; }
die() { echo "SETUP FAILED: $*"; exit 1; }

wait_apt() {
  if [ "$SKIP_WAIT" = "1" ]; then return 0; fi
  i=0
  while [ $i -lt 36 ]; do
    if pgrep -x apt-get >/dev/null 2>&1 || pgrep -x apt >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1 || pgrep -f '^bash /tmp/provision[.]sh' >/dev/null 2>&1; then
      if [ $((i % 6)) -eq 0 ]; then echo "waiting for another package install on this computer to finish..."; fi
      sleep 5
      i=$((i+1))
    else
      return 0
    fi
  done
  echo "another package install is still running after 3 minutes; continuing (apt waits for its own lock)"
  SKIP_WAIT=1
  return 0
}

APT="sudo -E apt-get -o Acquire::Retries=5 -o Dpkg::Lock::Timeout=600 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"

apt_refresh() {
  sudo rm -rf /var/lib/apt/lists/* 2>/dev/null
  sudo mkdir -p /var/lib/apt/lists/partial /var/cache/apt/archives/partial
  n=1
  while [ $n -le 4 ]; do
    wait_apt
    if $APT update -y; then return 0; fi
    echo "apt update failed (try $n of 4), retrying..."
    sleep $((n*4))
    n=$((n+1))
  done
  return 1
}

apt_get() {
  n=1
  while [ $n -le 3 ]; do
    wait_apt
    if $APT "$@"; then return 0; fi
    echo "apt-get $1 failed (try $n of 3): repairing and refreshing the package lists..."
    sudo dpkg --configure -a >/dev/null 2>&1
    $APT -f install -y >/dev/null 2>&1
    apt_refresh
    n=$((n+1))
  done
  return 1
}

apt_best_effort() {
  apt_get install -y "$@" && return 0
  echo "batch install failed, trying package by package"
  for p in "$@"; do
    wait_apt
    $APT install -y "$p" || echo "optional package $p skipped"
  done
  return 0
}

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]
}

step "[1/5] system packages"
apt_refresh || die "could not download the package lists from the Ubuntu mirrors"
apt_get install -y git curl ca-certificates unzip zip jq xz-utils || die "could not install the core tools (git, curl, zip)"
apt_best_effort ripgrep build-essential python3-pip python3-venv wget
apt_best_effort p7zip-full sqlite3 fd-find tree poppler-utils qpdf ffmpeg imagemagick pandoc tesseract-ocr xclip xdotool scrot fonts-liberation fonts-noto-core fonts-noto-color-emoji

step "[2/5] Node.js"
if ! node_ok; then
  if curl -fsSL --retry 3 -o /tmp/nodesource.sh https://deb.nodesource.com/setup_22.x && sudo -E bash /tmp/nodesource.sh && apt_get install -y nodejs; then
    echo "Node.js installed from NodeSource"
  else
    echo "NodeSource failed, using the official Node.js download instead"
  fi
fi
if ! node_ok; then
  NODE_FILE=$(curl -fsSL --retry 3 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' | head -1)
  [ -n "$NODE_FILE" ] || die "could not find a Node.js 22 download"
  curl -fsSL --retry 3 -o /tmp/node.tar.xz "https://nodejs.org/dist/latest-v22.x/$NODE_FILE" || die "could not download Node.js"
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 || die "could not unpack Node.js"
  hash -r
fi
node_ok || die "Node.js 22 is not available on this computer"
node -v

step "[3/5] Python libraries"
PYLIBS="pandas numpy matplotlib openpyxl xlsxwriter python-docx python-pptx reportlab pypdf pdfplumber pillow requests beautifulsoup4 lxml scipy markdown pytesseract"
if command -v pip3 >/dev/null 2>&1; then
  pip3 install --user -q $PYLIBS || pip3 install --user --break-system-packages -q $PYLIBS || {
    for l in $PYLIBS; do
      pip3 install --user -q $l || pip3 install --user --break-system-packages -q $l || echo "python library $l skipped"
    done
  }
else
  echo "pip3 is missing: Python libraries skipped"
fi

step "[4/5] folders"
mkdir -p "$HOME/.npm-global" /home/user/work ${assets} /home/user/Documents /home/user/Downloads /home/user/Desktop /tmp/jobs
npm config set prefix "$HOME/.npm-global"
echo "== REA (Reverse Engineer Anything)"
npm install --global rea-agents >/tmp/jobs/rea-install.log 2>&1 || echo "rea-agents global install skipped: use npx -y rea-agents@latest"
grep -q npm-global ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
echo ${PC_SETUP_VERSION} > /home/user/.code-version
touch /home/user/.code-ready
rm -f /tmp/jobs/codesetup.tries

step "[5/5] desktop apps (continue in the background)"
cat > /tmp/jobs/pcapps.sh <<'EOS'
export DEBIAN_FRONTEND=noninteractive
APT="sudo -E apt-get -o Acquire::Retries=5 -o Dpkg::Lock::Timeout=900"
n=1
while [ $n -le 3 ]; do
  $APT install -y --fix-missing libreoffice-writer libreoffice-calc libreoffice-impress gimp inkscape vlc evince mousepad file-roller && break
  $APT update -y
  n=$((n+1))
done
if ! command -v google-chrome >/dev/null 2>&1; then
  curl -fsSL --retry 3 -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && $APT install -y /tmp/chrome.deb
fi
if ! command -v code >/dev/null 2>&1; then
  curl -fsSL --retry 3 -o /tmp/vscode.deb https://go.microsoft.com/fwlink/?LinkID=760868 && $APT install -y /tmp/vscode.deb
fi
touch /home/user/.pc-apps-full
EOS
(nohup bash /tmp/jobs/pcapps.sh >/tmp/jobs/pcapps.log 2>&1 &)
echo "CODE TOOLS READY"
`;

/** Added to the computer agent's context on every task. */
export const PC_TOOLBELT_PROMPT = `## YOUR COMPUTER (already installed)
Browser: Google Chrome (the visible window; use "browse"). Editors: VS Code, Mousepad. Office: LibreOffice Writer / Calc / Impress (command: soffice), GIMP, Inkscape, VLC, Evince (PDF viewer). The big apps finish installing a few minutes after the computer first starts: check with "command -v soffice" before relying on them.
Command line: python3 with pandas, numpy, matplotlib, openpyxl, xlsxwriter, python-docx, python-pptx, reportlab, pypdf, pdfplumber, pillow, requests, beautifulsoup4, lxml, scipy; node 20; git; ripgrep; jq; sqlite3; ffmpeg; imagemagick; pandoc; tesseract OCR; poppler (pdftotext, pdftoppm); qpdf; zip / 7z.
MAKING FILES: Word = python-docx; Excel = openpyxl (formulas allowed); PowerPoint = python-pptx; PDF = reportlab, or "soffice --headless --convert-to pdf file.docx"; charts = matplotlib PNG; scanned text = "tesseract in.png out"; PDF text = pdftotext. Save results in ~/Documents and tell the owner the exact path. ALWAYS verify a file you made: re-open it with python, or convert and look at it.
EXTRA BROWSE OPS (besides click, type, secret, press, scroll, wait): {"op":"select","id":N,"value":"text"} {"op":"check","id":N,"checked":true} {"op":"hover","id":N} {"op":"upload","id":N,"path":"~/Documents/file.pdf"} {"op":"scroll_to","id":N} {"op":"back"} {"op":"wait_text","text":"Order confirmed","ms":8000} {"op":"newtab","url":"https://..."} {"op":"tab","index":0} {"op":"closetab"} {"op":"type_focus","text":"..."}. Cookie banners are dismissed automatically, browser dialogs are accepted, downloads land in ~/Downloads. If a click does nothing: re-read the elements, try scroll_to and click again, or use a screen click.
SOCIAL MEDIA: uploading or posting to YouTube, Instagram, TikTok, X, LinkedIn, Facebook, Threads, Pinterest or Reddit is done with the social.* tools in the chat, never by clicking around in a browser. If you were sent here to upload a video, say so in one line and stop.
RULES: prefer a connected tool or API over clicking around; write short progress notes; never claim success without evidence (a file that opens, a page that shows the result).

${REA_PC_PROMPT}`;
