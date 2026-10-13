# 拼豆图纸专业工作台

React + TypeScript + Vite / Fastify / SQLite 的本地图纸后处理系统。JSON 是唯一权威数据源，画布、统计、SVG 和矢量 PDF 均从指定修订版本生成。

源码仓库：[f3271174706-tech/Pattern-web](https://github.com/f3271174706-tech/Pattern-web)。在线工作台：[perler.cloud](https://perler.cloud/)。

## 启动

需要 Node.js **22.16 或更新的 22.x / 24.x** 和 npm。项目已包含中文 PDF 字体，不需要 Python、TeX 或外部 AI 服务。

Windows PowerShell：

```powershell
Set-Location -LiteralPath 'D:\vibe coding\Pattern web'
.\scripts\prepare-local.ps1
npm install --cache "$env:LOCALAPPDATA\bead-workbench-npm-cache"
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。API 在 `http://127.0.0.1:3001/api/v1`。前端代理 API，两者复用相同业务服务。

依赖就绪后也可直接运行 `.\scripts\start.ps1`。Windows 准备脚本仅为当前账户授予项目生成目录 `node_modules`、`data`、`dist` 的「修改」权限，并切换用户目录 npm 缓存，以兼容只继承「写入」权限的项目盘；不修改源码目录权限。

其他环境可直接执行 `npm ci && npm run dev`。首次启动只创建用户 MARD 221 色卡的花园和 3×2 示例。仅空数据库会创建示例。C01/D01 自定义色卡图纸只保留为协议测试文件，不进入默认图纸列表。

生产模式由同一个 Fastify 服务提供前端与 API：

```powershell
npm run build
npm start
```

打开 [http://127.0.0.1:3001](http://127.0.0.1:3001)。默认仅监听本地回环地址。

## 完整工作流

1. 「导入新图纸」上传 BeadPattern v1 JSON，或使用 `schema_version: 1`、`grid[y][x]` 的旧版 MARD 221 网格 JSON，可选附加 SVG/PDF。导入错误会标明 JSON Pointer；矩阵长度、色号、坐标体系和字段严格校验。
2. 预览从 JSON 生成。滚轮缩放、空格拖动平移、`0` 适应画布。图纸信息保留尺寸、珠数、颜色数与空格数。
3. 颜色选择先展示图纸已用色与实际用量；剩余颜色按字母分组，可展开或搜索。点击色号启用画笔，再点击画布绘制；也可使用橡皮、吸管和矩形选区。多格操作先展示预览，确认后才提交。
4. 每次提交即写入 SQLite，无未保存的隐式编辑。当前版本同步用于预览和材料统计。「保存 JSON」下载当前已保存版本。
5. 「材料统计」显示总珠数、空格、各色号数量/占比和各拼板用量；支持 CSV/JSON 导出、搜索、数量排序、颜色高亮。
6. 「版本记录」可比较版本和恢复。撤销、重做、恢复均产生新版本，历史不会被覆盖，撤销/重做状态可在重启后恢复。
7. 画布工具栏独立切换「色号」与「拼板编号」，后者默认关闭，控制网格中的 B1-1 等标识。两项设置立即保存并用于布局 SVG/PDF。「排版」单独提交显示/编号间隔、拼板、物理尺寸、纸张、方向、边距和分页设置。矩阵数据不变。
8. SVG/PDF 输出可选择来源版本及选区；选区导出的材料表只统计选区内珠子。PDF 采用矢量路径和矢量文字；按纸张或拼板分页，保持毫米尺寸。PDF 内附权威 JSON 与逐格矢量清单。中文字体完整嵌入，以保证跨阅读器显示，样例 PDF 约 6.5 MB。

SVG/PDF 原始档案始终保留，不参与修改，也未声称已验证其与 JSON 的视觉一致性。仅明确删除项目时删除其档案。

## MARD 221 色卡

`examples/palettes/mard221.json` 从用户提供的 `Mard221_色号HEX_带颜色.xlsx` 的 `Mard221!A2:B222` 读取，含 221 个唯一色号。色号与 HEX 逐项保留，无近似匹配。名称使用原始色号，未编造颜色名称。

原始 Excel 和 `mard221.source.json` 一并保存；后者记录原始文件 SHA-256、工作表、区域及每个色号的来源行。色卡版本为 `user-xlsx-c9c686326725`，代表该用户文件快照，不表示厂商认证。

新建图纸可选择 MARD-221。已有图纸不会自动更换色卡。「绑定色卡」需要用户明确确认，并拒绝缺少已使用色号的新色卡。可导入 `{id,version,colors}` 格式的其他色卡 JSON。

旧版导入会展示文件 HEX 与指定 Excel 色卡的逐项差异。网页默认选择指定 MARD 221 色卡；也可选择原文件 HEX，此时色卡标记为 `MARD-221-source`。两种模式均保留全部格子的色号、位置与空格，不执行近似匹配、镜像或重排；外部操作坐标转为 1-based。统计重新从矩阵计算，过期的文件数量只作为提示。原始 JSON 逐字归档，服务器重新转换并核对提交内容，修订记录保存模式与差异。

命令行转换生成独立文件，不覆盖原文件：`npx tsx scripts/convert-legacy-pattern.ts input.json output.json mard221`；最后参数也可用 `source` 保留原文件 HEX。

## 项目结构

```text
apps/web/                 React 编辑工作台、Canvas 2D
apps/api/                 Fastify、SQLite 仓储、导出 worker
packages/core/            校验、统计、编辑、差异、统一矢量场景
packages/mcp-adapter/     不依赖 MCP 传输的工具与权限边界
docs/json-schema/         BeadPattern v1 JSON Schema
docs/api/                 OpenAPI 3.1 与调用示例
docs/architecture/        架构、协议升级与未来连接设计
examples/                 3×2、58×58 与 MARD 示例、色卡及来源
assets/fonts/             Noto Sans SC 中文 TrueType 字体与 OFL 许可
tests/                    Vitest 核心/API/矢量测试、Playwright 流程
data/                     自动生成 SQLite 数据库，不提交到源码
```

## 测试与验收

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
# 或一次执行全部检查
npm run check
```

Windows 浏览器测试使用已安装的 Microsoft Edge，其他平台先运行 `npx playwright install chromium`。测试数据库、Vite 缓存及 Playwright 报告位于每次运行独立的系统临时目录，不改动工作区图纸。PDF 测试样例在 `output/pdf/`，浏览器截图在 `output/`。

核心测试覆盖任务书的十项验收条件，另包含幂等、原始档案、色卡绑定、布局隔离、认证、MCP 权限和 200×200 操作。实际执行结果见 `docs/test-results.md`。

## API

机器可读规范：`docs/api/openapi.json`、运行中的 `/api/v1/openapi.json`。JSON Schema 在 `/api/v1/schema.json`。调用示例见 `docs/api/examples.md`。

所有外部修改使用 1-based `(x,y)`，对应 `cells[y-1][x-1]`。`baseRevision` 不一致返回 409；`expectedColor` 不一致返回 409；任何操作失败都不提交整组。相同 `idempotencyKey` 与相同请求返回原响应，复用键提交其他请求返回 409。

导出通过 `revision` 明确选择快照，响应附 `X-Pattern-Revision`、`X-Pattern-Digest`、文件摘要 ETag；SQLite 导出记录保存数据摘要、文件摘要、输出选项和时间。

## 存储与部署

已按用户选择部署并替换 [perler.cloud](https://perler.cloud/)，使用服务器原有 Node.js、systemd 和 Cloudflare Tunnel。当前默认图纸只使用用户的 MARD 221 色卡。用户要求关闭登录密钥后，通过 `PUBLIC_ACCESS=true` 启用直接访问，详情见 [服务器部署记录](docs/deployment.md)。

默认 `data/workbench.sqlite`，采用 WAL；SQLite 文件、日志及原始档案共用数据库，附件不使用用户提供的名字写入文件系统。运行服务的账户须有数据目录的读、写、创建及删除权限。Windows 若出现 `disk I/O error`，请为**数据目录**授予当前账户「修改」权限，或将 `DATABASE_PATH` 指向可写的用户目录：

```powershell
$env:DATABASE_PATH = "$env:LOCALAPPDATA\BeadWorkbench\workbench.sqlite"
npm run dev
```

`.env.example` 提供配置示例；PowerShell 用 `$env:NAME=...` 设置环境变量，或使用 Node 的环境文件功能。应用不会自动读取 `.env`。

默认认证模式下，非回环地址必须同时设置至少 32 字符的 `API_TOKEN` 及 HTTPS `PUBLIC_ORIGIN`，否则拒绝启动。网页令牌通过服务端 HttpOnly / SameSite=Strict 会话 Cookie 保存，不写入前端源码或 localStorage。API 支持 `Authorization: Bearer ...`。显式设置 `PUBLIC_ACCESS=true` 及 HTTPS `PUBLIC_ORIGIN` 后不要求登录或密钥；默认仍为本地/认证模式。一个部署共用一个工作区；目前没有多用户账户和项目级团队授权。

`Dockerfile` 与 `compose.yaml` 可用于自托管。设置两项环境变量后 `docker compose up --build -d`，数据存储在命名卷 `bead-data`，端口仅映射本机回环。公网使用 HTTPS 反向代理，`PUBLIC_ORIGIN` 必须与访问来源一致。Docker 配置未在本次 Windows 环境实际启动验证。

备份：关闭服务后复制完整 SQLite 数据文件；在线备份应使用 SQLite Backup API，不能只复制正在写入的主库文件。恢复备份时保持原始档案和修订记录一起恢复。

## 当前边界

- 图纸最大 500×500；200×200 已纳入自动化测试。单次最多 1,000 个操作、扫描 100 万格、实际修改 10 万格。
- JSON 请求上限 24 MB；网页 JSON 文件上限 16 MB；每个原始 SVG/PDF 上限 8 MB，最多两个。
- 最多两个并发导出 worker，每个最长 60 秒；PDF 最多 400 张图纸分页，另有材料表页。繁忙返回 429，不混用版本。
- 已实现 `/mcp` 的两个公开只读示例工具，使用官方 SDK；本次生产发布及 ChatGPT 账号连接待用户确认。用户图纸与编辑工具没有公开。没有照片转换、像素化、图片识别或 AI 自动绘图。
- 暂未实现协作账户、裁切/改变图纸尺寸、镜像、自动补色、色卡 Excel 通用上传解析；用户色卡已从提供的 Excel 严格转换，其他色卡采用 JSON 导入。
- PDF 保留完整形状坐标清单，阅读器可提取附件。SVG 浏览器显示字体依赖阅读器可用字体，珠子几何不依赖字体。
- Node.js 22 的 `node:sqlite` 会输出实验性提示，本项目已在 Node 22.22.2 实测；数据库接口集中在 `PatternStore`，后续可更换实现。

公开目录、接口边界和 ChatGPT 连接步骤见 `docs/architecture/mcp.md`；不假定账号已安装或能够使用自定义 MCP 插件。生产变更与回滚方案见 `docs/mcp-deployment-plan.md`。
