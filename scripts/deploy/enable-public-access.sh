#!/usr/bin/env bash
set -euo pipefail
backup="/var/backups/perler-cloud/public-access-$(date -u +%Y%m%d-%H%M%S)"
install -d -m 0700 "$backup"
cp -a /etc/perler-cloud/workbench.env "$backup/workbench.env"
python3 - <<'PY'
from pathlib import Path
path = Path('/etc/perler-cloud/workbench.env')
lines = [line for line in path.read_text().splitlines() if not line.startswith('PUBLIC_ACCESS=')]
assert 'PUBLIC_ORIGIN=https://perler.cloud' in lines
path.write_text('\n'.join(lines) + '\nPUBLIC_ACCESS=true\n')
PY
echo 'Public access explicitly enabled for the next release; previous environment backed up.'
