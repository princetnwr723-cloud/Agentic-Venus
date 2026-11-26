#!/bin/bash
# Starts the phone computer's screen (Xvfb) and the guest agent. Runs inside proot every time the computer starts.
# $1 = the port for the agent (127.0.0.1 only, and every request needs the secret key).
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/home/user DISPLAY=:0 TMPDIR=/tmp LANG=C.UTF-8
mkdir -p /tmp/.X11-unix /home/user /var/lib /tmp/venus
chmod 1777 /tmp /tmp/.X11-unix 2>/dev/null
rm -f /tmp/.X0-lock /tmp/.X11-unix/X0 /var/lib/venus-ready
Xvfb :0 -screen 0 "${VENUS_SCREEN:-1280x720x24}" -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &
for i in $(seq 1 60); do [ -S /tmp/.X11-unix/X0 ] && break; sleep 0.2; done
cd /home/user || exit 1
VENUS_AGENT_NOSUDO=1 VENUS_AGENT_BIND=127.0.0.1 VENUS_AGENT_PORT="$1" \
  python3 /usr/local/bin/venus-agent.py >/tmp/agent.log 2>&1 &
for i in $(seq 1 60); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep 0.2; done
touch /var/lib/venus-ready
wait
