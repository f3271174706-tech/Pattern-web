#!/usr/bin/env bash
set -euo pipefail
archive=$1
release_id=$2
expected_sha=$3
[[ "$release_id" =~ ^[0-9]{8}-[0-9]{6}-mard221-workbench$ ]]
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum --check --status
release="/opt/perler-cloud/releases/$release_id"
if [[ -e "$release" ]]; then echo 'Release already exists; use its recorded path for resume.'; exit 2; fi
install -d -m 0755 "$release"
tar -xzf "$archive" -C "$release" --no-same-owner --no-same-permissions
export PATH="/opt/nodejs/node-v22.23.2-linux-x64/bin:$PATH"
cd "$release"
echo 'Installing locked dependencies through the existing server proxy.'
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm ci --cache /root/.cache/bead-workbench-npm --no-audit --fund=false
npm run build
npm test
install -d -o perler-cloud -g perler-cloud -m 0700 /var/lib/perler-cloud/workbench
install -d -m 0750 /etc/perler-cloud
python3 - <<'PY'
from pathlib import Path
import os, pwd, grp, secrets
path = Path('/etc/perler-cloud/workbench.env')
if not path.exists():
    path.write_text('HOST=127.0.0.1\nPORT=18040\nPUBLIC_ORIGIN=https://perler.cloud\nAPI_TOKEN=' + secrets.token_hex(32) + '\nDATABASE_PATH=/var/lib/perler-cloud/workbench/workbench.sqlite\nNODE_ENV=production\nSEED_DEMO=true\n')
for target in [path, Path('/etc/perler-cloud/workbench-staging.env')]:
    if target != path:
        target.write_text(path.read_text().replace('PORT=18040\n', 'PORT=18050\n'))
    os.chmod(target, 0o640)
    os.chown(target, 0, grp.getgrnam('perler-cloud').gr_gid)
PY
cat > /etc/systemd/system/perler-workbench-staging.service <<EOF
[Unit]
Description=perler.cloud BeadPattern workbench staging verification
After=network-online.target
[Service]
Type=simple
User=perler-cloud
Group=perler-cloud
WorkingDirectory=$release
EnvironmentFile=/etc/perler-cloud/workbench-staging.env
ExecStart=/opt/nodejs/node-v22.23.2-linux-x64/bin/node --import tsx $release/apps/api/src/server.ts
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
EOF
systemctl daemon-reload
systemctl start perler-workbench-staging.service
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:18050/api/v1/health >/dev/null; then break; fi
  sleep 1
done
node scripts/deploy/smoke.mjs http://127.0.0.1:18050 /etc/perler-cloud/workbench-staging.env
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('/var/lib/perler-cloud/workbench/workbench.sqlite')
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print('Staging SQLite integrity_check=ok')
db.close()
PY
printf 'Staging verified: %s\n' "$release"
