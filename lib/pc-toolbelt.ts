// What is installed on every agent computer, and how the agent is told to use it.
import { REA_PC_PROMPT } from "@/lib/rea-policy";

export const PC_SETUP_VERSION = "6";

/** Core tools install first (the computer is "ready" after this); the big desktop apps install in the background. */
export const pcSetupScript = (assets: string) => `set -e
export DEBIAN_FRONTEND=noninteractive
echo 'DPkg::Lock::Timeout "900";' | sudo tee /etc/apt/apt.conf.d/99locktimeout >/dev/null
echo "== [1/5] system packages"
sudo apt-get update -y || true
sudo apt-get install -y git ripgrep zip unzip jq build-essential python3-pip python3-venv curl wget ca-certificates
sudo apt-get install -y p7zip-full sqlite3 fd-find tree poppler-utils qpdf ffmpeg imagemagick pandoc tesseract-ocr xclip xdotool scrot fonts-liberation fonts-noto-core fonts-noto-color-emoji || true
echo "== [2/5] Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
echo "== [3/5] Python libraries"
PYLIBS="pandas numpy matplotlib openpyxl xlsxwriter python-docx python-pptx reportlab pypdf pdfplumber pillow requests beautifulsoup4 lxml scipy markdown pytesseract"
pip3 install --user -q $PYLIBS || pip3 install --user --break-system-packages -q $PYLIBS || true
echo "== [4/5] folders"
mkdir -p "$HOME/.npm-global" /home/user/work ${assets} /home/user/Documents /home/user/Downloads /home/user/Desktop /tmp/jobs
npm config set prefix "$HOME/.npm-global"
echo "== REA (Reverse Engineer Anything)"
npm install --global rea-agents >/tmp/jobs/rea-install.log 2>&1 || echo "rea-agents global install skipped: use npx -y rea-agents@latest"
grep -q npm-global ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
echo ${PC_SETUP_VERSION} > /home/user/.code-version
touch /home/user/.code-ready
echo "== [5/5] desktop apps (continue in the background)"
(nohup bash -lc 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libreoffice-writer libreoffice-calc libreoffice-impress gimp inkscape vlc evince mousepad file-roller || true; touch /home/user/.pc-apps-full' >/tmp/jobs/pcapps.log 2>&1 &)
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