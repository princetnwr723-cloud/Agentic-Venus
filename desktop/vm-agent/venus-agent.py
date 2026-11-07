#!/usr/bin/env python3
"""AgenticVenus guest agent. Runs INSIDE the Linux virtual machine on the user's PC.

It only listens inside the VM; QEMU forwards one port from 127.0.0.1 of the PC to it, and every request needs the
secret key that was created when the computer was set up. It runs commands, takes screenshots and sends mouse/keyboard
input. It never talks to the internet by itself.
"""
import base64, hmac, json, os, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("VENUS_AGENT_PORT", "7077"))
KEY_FILE = os.environ.get("VENUS_AGENT_KEYFILE", "/etc/venus-agent.key")
READY_FILE = os.environ.get("VENUS_AGENT_READY", "/var/lib/venus-ready")
RUN_USER = os.environ.get("VENUS_AGENT_USER", "user")
NOSUDO = os.environ.get("VENUS_AGENT_NOSUDO") == "1"  # only for tests
MAX_BODY = 8_000_000
MAX_OUT = 200_000

def load_key():
    with open(KEY_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()

KEY = load_key()
if len(KEY) < 32:
    sys.exit("agent key too short")

def as_user(argv, env_extra=None):
    env = dict(os.environ)
    env.update({"DISPLAY": ":0", "HOME": "/home/" + RUN_USER})
    if env_extra:
        env.update(env_extra)
    if NOSUDO:
        return argv, env
    return ["sudo", "-u", RUN_USER, "-H", "env", "DISPLAY=:0"] + argv, env

def run(argv, timeout, shell_cmd=None):
    if shell_cmd is not None:
        argv = ["bash", "-lc", shell_cmd]
    full, env = as_user(argv)
    try:
        p = subprocess.run(full, capture_output=True, timeout=timeout, env=env, cwd=None if NOSUDO else "/home/" + RUN_USER)
        return {"stdout": p.stdout.decode("utf-8", "replace")[-MAX_OUT:], "stderr": p.stderr.decode("utf-8", "replace")[-MAX_OUT:], "exitCode": p.returncode}
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", "replace")[-MAX_OUT:]
        return {"stdout": out, "stderr": "timed out after %ss" % timeout, "exitCode": 124}

BUTTON = {"click": "1", "right_click": "3"}

def do_input(a):
    t = a.get("type")
    if t in ("click", "double_click", "right_click"):
        x, y = int(a.get("x", 0)), int(a.get("y", 0))
        argv = ["xdotool", "mousemove", str(x), str(y)]
        if t == "double_click":
            argv += ["click", "--repeat", "2", "--delay", "80", "1"]
        else:
            argv += ["click", BUTTON[t]]
        return run(argv, 15)
    if t == "type":
        return run(["xdotool", "type", "--delay", "20", "--", str(a.get("text", ""))[:4000]], 60)
    if t == "key":
        return run(["xdotool", "key", "--", str(a.get("keys", ""))[:100]], 15)
    if t == "scroll":
        b = "4" if a.get("direction") == "up" else "5"
        return run(["xdotool", "click", "--repeat", str(max(1, min(50, int(a.get("amount", 3))))), "--delay", "30", b], 20)
    return {"stdout": "", "stderr": "unknown input", "exitCode": 2}

def screenshot():
    path = "/tmp/venus-shot.jpg"
    r = run(["scrot", "-o", "-q", "70", path], 20)
    if r["exitCode"] != 0:
        return {"stdout": "", "stderr": r["stderr"] or "screenshot failed", "exitCode": r["exitCode"]}
    with open(path, "rb") as f:
        return {"stdout": "", "stderr": "", "exitCode": 0, "data": base64.b64encode(f.read()).decode()}

class H(BaseHTTPRequestHandler):
    server_version = "VenusAgent"
    def log_message(self, *a):
        pass
    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def _authed(self):
        got = self.headers.get("X-Venus-Key", "")
        return hmac.compare_digest(got.encode(), KEY.encode())
    def do_GET(self):
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        if self.path == "/health":
            return self._send(200, {"ok": True, "ready": os.path.exists(READY_FILE)})
        return self._send(404, {"error": "not found"})
    def do_POST(self):
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > MAX_BODY:
                return self._send(413, {"error": "too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/exec":
                t = max(1, min(300, int(body.get("timeoutMs", 30000)) / 1000))
                return self._send(200, run(None, t, shell_cmd=str(body.get("cmd", ""))))
            if self.path == "/screenshot":
                return self._send(200, screenshot())
            if self.path == "/input":
                return self._send(200, do_input(body))
            return self._send(404, {"error": "not found"})
        except Exception as e:  # never crash the agent
            return self._send(500, {"error": str(e)[:300]})

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()