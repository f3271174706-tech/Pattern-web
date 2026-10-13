# REST API 调用示例

本地开发默认无需令牌且仅监听回环地址。远程认证模式给请求附 `Authorization: Bearer <API_TOKEN>`；不要把真实密钥写入源码或提交到 Git。

## PowerShell

```powershell
$api = 'http://127.0.0.1:3001/api/v1'
$json = Get-Content -LiteralPath '.\examples\demo-3x2.json' -Raw
# 若此 ID 的示例已存在，请先更改 patternId 后导入，避免 409 重复 ID。
$project = $json | ConvertFrom-Json
$project.patternId = 'external-example'
$created = Invoke-RestMethod -Method Post -Uri "$api/patterns" `
  -ContentType 'application/json' -Body ($project | ConvertTo-Json -Depth 20)

$id = $created.pattern.patternId
$current = Invoke-RestMethod "$api/patterns/$id"
$stats = Invoke-RestMethod "$api/patterns/$id/stats"

$edit = @{
  baseRevision = $current.pattern.revision
  idempotencyKey = [guid]::NewGuid().ToString()
  operations = @(@{type='set_cell'; x=1; y=1; expectedColor='C01'; newColor='C02'})
} | ConvertTo-Json -Depth 10

$preview = Invoke-RestMethod -Method Post -Uri "$api/patterns/$id/edits/preview" `
  -ContentType 'application/json' -Body $edit
$preview | ConvertTo-Json -Depth 10
# 在检查 preview.changedCells、changes 和 colorDeltas 后才提交。
$committed = Invoke-RestMethod -Method Post -Uri "$api/patterns/$id/edits/commit" `
  -ContentType 'application/json' -Body $edit
$revision = $committed.pattern.revision
Invoke-WebRequest "$api/patterns/$id/exports/svg?revision=$revision" -OutFile '.\edited.svg'
Invoke-WebRequest "$api/patterns/$id/exports/pdf?revision=$revision" -OutFile '.\edited.pdf'
Invoke-WebRequest "$api/patterns/$id/stats?revision=$revision&format=csv" -OutFile '.\materials.csv'
```

## JavaScript

```js
const origin = "http://127.0.0.1:3001/api/v1";
const request = {
  baseRevision: 1,
  idempotencyKey: crypto.randomUUID(),
  operations: [
    {
      type: "replace_color_in_rect",
      rect: { x1: 1, y1: 1, x2: 2, y2: 1 },
      oldColor: "C01",
      newColor: "C02",
    },
  ],
};
const preview = await fetch(
  `${origin}/patterns/external-example/edits/preview`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  },
).then((r) => r.json());
// Review preview, then submit the same baseRevision and operations to edits/commit.
```

`fill_rect` 的 `nonEmptyOnly: true` 仅修改已有珠子，保留空格；`newColor: null` 将目标设为空格。`expectedColor: null` 保护原本为空的格子。

## 统一错误

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "当前版本为 4",
    "path": "/baseRevision",
    "details": { "currentRevision": 4 }
  }
}
```

收到 409 后获取当前图纸，重新预览；不要把旧操作的 `baseRevision` 改成最新数值后直接强行提交。保留原 `expectedColor` 以保护目标格子。
