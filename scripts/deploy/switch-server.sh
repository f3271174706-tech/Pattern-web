#!/usr/bin/env bash
set -euo pipefail
release_id=$1
[[ "$release_id" =~ ^[0-9]{8}-[0-9]{6}-mard221-workbench$ ]]
release="/opt/perler-cloud/releases/$release_id"
test -f "$release/dist/web/index.html"
test -f /var/lib/perler-cloud/workbench/verification/latest-smoke.json
backup="/var/backups/perler-cloud/$release_id"
install -d -m 0700 "$backup"
readlink -f /opt/perler-cloud/current > "$backup/previous-release.txt"
cp -a /etc/systemd/system/perler-cloud.service "$backup/perler-cloud.service"
cp -a /etc/perler-cloud "$backup/config"
systemctl stop perler-workbench-staging.service
systemctl stop perler-cloud.service
cp -a /var/lib/perler-cloud "$backup/data"
rollback() {
  echo 'Verification failed; restoring the previous service and release.'
  cp -a "$backup/perler-cloud.service" /etc/systemd/system/perler-cloud.service
  ln -s "$(cat "$backup/previous-release.txt")" /opt/perler-cloud/current.rollback
  mv -Tf /opt/perler-cloud/current.rollback /opt/perler-cloud/current
  systemctl daemon-reload
  systemctl start perler-cloud.service
  systemctl start cloudflared-perler-cloud.service
}
trap rollback ERR
cat > /etc/systemd/system/perler-cloud.service <<'UNIT'
[Unit]
Description=perler.cloud MARD 221 BeadPattern professional workbench
After=network-online.target
Wants=network-online.target cloudflared-perler-cloud.service
[Service]
Type=simple
User=perler-cloud
Group=perler-cloud
WorkingDirectory=/opt/perler-cloud/current
EnvironmentFile=/etc/perler-cloud/workbench.env
ExecStart=/opt/nodejs/node-v22.23.2-linux-x64/bin/node --import tsx /opt/perler-cloud/current/apps/api/src/server.ts
Restart=on-failure
RestartSec=3s
UMask=0027
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/perler-cloud/workbench
MemoryHigh=512M
MemoryMax=768M
TasksMax=128
[Install]
WantedBy=multi-user.target
UNIT
ln -s "$release" /opt/perler-cloud/current.next
mv -Tf /opt/perler-cloud/current.next /opt/perler-cloud/current
systemctl daemon-reload
systemctl enable --now perler-cloud.service
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:18040/api/v1/health >/dev/null; then break; fi
  sleep 1
done
export PATH="/opt/nodejs/node-v22.23.2-linux-x64/bin:$PATH"
cd "$release"
node scripts/deploy/smoke.mjs http://127.0.0.1:18040 /etc/perler-cloud/workbench.env
node scripts/deploy/persistence.mjs create
systemctl restart perler-cloud.service
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:18040/api/v1/health >/dev/null; then break; fi
  sleep 1
done
node scripts/deploy/persistence.mjs verify
systemctl start cloudflared-perler-cloud.service
systemctl is-active perler-cloud.service
systemctl is-active cloudflared-perler-cloud.service
systemctl is-enabled perler-cloud.service
trap - ERR
printf 'Production release: %s\nRollback backup: %s\n' "$release" "$backup"
