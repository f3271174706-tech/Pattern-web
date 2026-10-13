#!/usr/bin/env bash
set -euo pipefail
echo 'Current release'
readlink -f /opt/perler-cloud/current
echo 'Nonroot service and resource limits'
systemctl show perler-cloud.service -p User -p MemoryCurrent -p MemoryMax -p Wants
echo 'All loopback health endpoints'
for url in http://127.0.0.1:3000/health http://127.0.0.1:9000/health/ready http://127.0.0.1:18030/healthz http://127.0.0.1:18020/api/health http://127.0.0.1:18040/api/v1/health; do
  curl -fsS -o /dev/null -w '%{http_code} %{url_effective}\n' --max-time 10 "$url"
done
echo 'All Tunnel registrations'
for port in 20241 20242 20243 20244 20245; do
  printf '%s ' "$port"
  curl -fsS "http://127.0.0.1:$port/metrics" | grep '^cloudflared_tunnel_ha_connections'
done
echo 'Read-only SQLite integrity'
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('file:/var/lib/perler-cloud/workbench/workbench.sqlite?mode=ro',uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print('integrity_check=ok')
print('projects:',db.execute('SELECT count(*) FROM patterns').fetchone()[0])
db.close()
PY
systemctl --failed --no-pager
