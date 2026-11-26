#!/bin/sh
# Runs ONCE inside the phone computer (Alpine Linux under proot, fake root).
# Installs only what a computer task needs: Chrome, a terminal, and the small tools the agent uses. No desktop, no extra apps.
set -e
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf

# Chromium lives in the "community" repository: make sure it is on
REPO=/etc/apk/repositories
if ! grep -q '/community' "$REPO" 2>/dev/null; then
  MAIN=$(grep -m1 '/main' "$REPO" | sed 's#/main.*##')
  [ -n "$MAIN" ] && echo "$MAIN/community" >> "$REPO"
fi

apk add --no-cache bash curl ca-certificates tzdata git python3 nodejs npm unzip zip \
  xvfb xterm xdotool scrot chromium font-dejavu
apk add --no-cache procps-ng || apk add --no-cache procps || true

mkdir -p /home/user/Desktop /home/user/Documents /home/user/Downloads /home/user/work /home/user/runner /var/lib /tmp /usr/local/bin
chmod 1777 /tmp

# google-chrome: the website opens "google-chrome", the phone has Chromium. Same browser, phone-friendly flags.
cat > /usr/local/bin/google-chrome <<'WRAP'
#!/bin/sh
C=$(command -v chromium-browser || command -v chromium)
exec "$C" --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check \
  --disable-background-networking --disable-sync --disable-translate --mute-audio \
  --renderer-process-limit=2 --js-flags=--max-old-space-size=768 \
  --window-position=0,0 --window-size=1280,720 "$@"
WRAP

# terminal: the website opens "xfce4-terminal"; the phone computer has the small xterm
cat > /usr/local/bin/xfce4-terminal <<'WRAP'
#!/bin/sh
exec xterm -geometry 120x34+0+0 -fa 'DejaVu Sans Mono' -fs 11 -bg black -fg white
WRAP
cp /usr/local/bin/xfce4-terminal /usr/local/bin/x-terminal-emulator

cat > /usr/local/bin/xdg-open <<'WRAP'
#!/bin/sh
exec google-chrome "$@"
WRAP

# no sudo and no apt here: everything already runs as the computer's own root. These two keep the website's scripts working.
cat > /usr/local/bin/sudo <<'WRAP'
#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in
    -u|-g|-h|-p|-C|-D|-R|-T|-U) shift 2 ;;
    --) shift; break ;;
    -*) shift ;;
    *=*) export "$1"; shift ;;
    *) break ;;
  esac
done
exec "$@"
WRAP

cat > /usr/local/bin/apt-get <<'WRAP'
#!/bin/sh
# apt-get -> apk. Only "install" does anything. ffmpeg (screen recording proof) is skipped to keep the storage small.
cmd=""
pk=""
skip_next=0
for a in "$@"; do
  if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
  case "$a" in
    -o) skip_next=1 ;;
    -*) ;;
    install|update|upgrade|remove|purge) [ -z "$cmd" ] && cmd="$a" || pk="$pk $a" ;;
    *) pk="$pk $a" ;;
  esac
done
[ "$cmd" = "install" ] || exit 0
for p in $pk; do
  case "$p" in ffmpeg|/tmp/*.deb) continue ;; esac
  apk add --no-cache "$p" >/dev/null 2>&1 || true
done
exit 0
WRAP

chmod 755 /usr/local/bin/google-chrome /usr/local/bin/xfce4-terminal /usr/local/bin/x-terminal-emulator \
  /usr/local/bin/xdg-open /usr/local/bin/sudo /usr/local/bin/apt-get
touch /var/lib/venus-setup-done
echo "VENUS_SETUP_DONE"
