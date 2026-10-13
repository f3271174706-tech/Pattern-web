from pathlib import Path
import hashlib, json, tarfile
root = Path(__file__).resolve().parents[2]
target = root / 'output' / 'deploy' / 'workbench-source.tar.gz'
target.parent.mkdir(parents=True, exist_ok=True)
paths = ['apps','packages','assets','examples','docs','tests','scripts','package.json','package-lock.json','tsconfig.json','vitest.config.ts','playwright.config.ts','README.md','.npmrc','.gitignore','Dockerfile','.dockerignore','compose.yaml']
def filter_entry(entry):
    parts = Path(entry.name).parts
    if any(p in {'node_modules','data','tmp','dist','output','npm-cache','.git','.env'} for p in parts):
        return None
    entry.uid = entry.gid = 0
    entry.uname = entry.gname = 'root'
    entry.mode = 0o755 if entry.isdir() or entry.name.endswith('.sh') else 0o644
    return entry
with tarfile.open(target, 'w:gz') as archive:
    for name in paths:
        archive.add(root / name, arcname=name, filter=filter_entry)
print(json.dumps({'archive':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
