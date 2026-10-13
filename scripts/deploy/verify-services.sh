#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/systemd/system/perler-cloud.service')
t=p.read_text().replace('Wants=network-online.target\n','Wants=network-online.target cloudflared-perler-cloud.service\n')
q=p.with_suffix('.service.next')
q.write_text(t)
q.chmod(0o644)
q.replace(p)
PY
systemctl daemon-reload
systemctl restart perler-cloud.service
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:18040/api/v1/health >/dev/null 2>&1; then break; fi
  sleep 1
done
systemctl is-active perler-cloud.service
systemctl is-active cloudflared-perler-cloud.service
systemctl is-enabled perler-cloud.service
for attempt in {1..30}; do
  value=$(curl -fsS http://127.0.0.1:20243/metrics 2>/dev/null | grep '^cloudflared_tunnel_ha_connections' || true)
  if [[ "$value" == *' 4' ]]; then echo "$value"; break; fi
  sleep 1
done
ss -lnt | grep -E ':18040|:20243'
systemctl --failed --no-pager
