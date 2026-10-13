"""Read-only extraction of the user's workbook; no color approximation."""
from pathlib import Path
import hashlib, json, re, shutil, sys
import openpyxl

source = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
wb = openpyxl.load_workbook(source, data_only=True, read_only=True)
sheet = wb['Mard221']
colors, rows = {}, []
for row_number, (code, value) in enumerate(sheet.iter_rows(min_row=2, max_col=2, values_only=True), 2):
    if code is None and value is None:
        continue
    if not isinstance(code, str) or not re.fullmatch(r'[A-Z]+[0-9]+', code):
        raise ValueError(f'Invalid color code at A{row_number}: {code!r}')
    if code in colors:
        raise ValueError(f'Duplicate code at A{row_number}: {code}')
    if not isinstance(value, str) or not re.fullmatch(r'#[0-9A-Fa-f]{6}', value):
        raise ValueError(f'Invalid HEX at B{row_number}: {value!r}')
    colors[code] = {'name': code, 'hex': value}
    rows.append({'code': code, 'sourceRow': row_number})
if len(colors) != 221:
    raise ValueError(f'Expected 221 colors, got {len(colors)}')
digest = hashlib.sha256(source.read_bytes()).hexdigest()
target = root / 'examples' / 'palettes'
target.mkdir(parents=True, exist_ok=True)
(target / 'mard221.json').write_text(json.dumps({'id': 'MARD-221', 'version': f'user-xlsx-{digest[:12]}', 'colors': colors}, ensure_ascii=False, indent=2), encoding='utf-8')
(target / 'mard221.source.json').write_text(json.dumps({'sourceFile': source.name, 'sha256': digest, 'sheet': 'Mard221', 'range': 'A2:B222', 'colorCount': len(colors), 'authority': 'User-supplied workbook, not independently certified against manufacturer', 'rows': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
shutil.copy2(source, target / source.name)
wb.close()
print(json.dumps({'colors':len(colors),'sha256':digest,'samples':{k:colors[k] for k in ['A1','B12','B15','H1','H2','H7'] if k in colors}}))
