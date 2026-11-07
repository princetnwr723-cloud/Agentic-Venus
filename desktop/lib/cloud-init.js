"use strict";
// First boot of the Linux computer: creates the user, installs the desktop and the agent. Served to the VM over a tiny
// local web server (cloud-init "NoCloud"), so no ISO tool is needed.
const http = require("http");

function userData({ agentKey, agentScript, arch }) {
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const browser = arch === "arm64"
    ? "apt-get install -y chromium-browser || true; ln -sf \"$(command -v chromium-browser || command -v chromium)\" /usr/local/bin/google-chrome || true"
    : "curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/chrome.deb || true";
  return `#cloud-config
hostname: venus-computer
users:
  - name: user
    gecos: AgenticVenus
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
package_update: true
packages: [xfce4, xfce4-terminal, lightdm, lightdm-gtk-greeter, xdotool, scrot, python3, curl, git, xdg-utils, nodejs, npm, build-essential, dbus-x11]
write_files:
  - path: /etc/venus-agent.key
    permissions: '0600'
    owner: root:root
    content: ${agentKey}
  - path: /usr/local/bin/venus-agent.py
    permissions: '0755'
    encoding: b64
    content: ${b64(agentScript)}
  - path: /etc/systemd/system/venus-agent.service
    content: |
      [Unit]
      Description=AgenticVenus guest agent
      After=network.target
      [Service]
      ExecStart=/usr/bin/python3 /usr/local/bin/venus-agent.py
      Restart=always
      [Install]
      WantedBy=multi-user.target
  - path: /etc/lightdm/lightdm.conf.d/50-venus.conf
    content: |
      [Seat:*]
      autologin-user=user
      autologin-session=xfce
runcmd:
  - mkdir -p /home/user/Desktop /home/user/Documents /home/user/Downloads /home/user/work
  - chown -R user:user /home/user
  - systemctl enable --now venus-agent.service
  - systemctl set-default graphical.target
  - [ bash, -c, "${browser.replace(/"/g, '\\"')}" ]
  - systemctl restart lightdm || true
  - touch /var/lib/venus-ready
`;
}

/** Serves /user-data and /meta-data on 127.0.0.1 (the VM reaches it as 10.0.2.2). Returns { port, close, fetched }. */
function serveSeed(data) {
  const state = { fetched: false };
  const srv = http.createServer((req, res) => {
    if (req.url === "/user-data") { state.fetched = true; res.end(data); }
    else if (req.url === "/meta-data") res.end("instance-id: venus-computer-1\nlocal-hostname: venus-computer\n");
    else if (req.url === "/vendor-data") res.end("");
    else { res.statusCode = 404; res.end(); }
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, close: () => srv.close(), state }));
  });
}

module.exports = { userData, serveSeed };