# MCP 完整工作台接入：待生产确认

按所有者「MCP 不仅要公开工作台所有已保存图纸的元数据和预览，还要提供修改等其他所有功能」要求，复用现有 PatternStore、核心校验及 REST 导出/附件接口，新增完整图纸工具集。此文的 26 个工具已完成代码和本地验证，生产仍为先前的两个只读工具；没有合并、重启或发布本次更新。

## 工具覆盖

| 工具 | 对应能力 |
| --- | --- |
| list_example_patterns / get_example_pattern | 保留已有的全部图纸元数据与预览接口 |
| get_workbench_info | BeadPattern v1、修改 schema、默认排版、限制与确认流程 |
| list_patterns | 真实图库列表、分页 |
| get_pattern | 当前或历史版本完整网格、色卡、排版、摘要与撤销/重做状态 |
| get_pattern_region | 选区精确网格与色卡，坐标从 1 开始 |
| get_pattern_stats | 材料、颜色、拼板统计和 CSV，可指定选区 |
| list_palettes | 原始 MARD 221 实际色卡或指定图纸色卡 |
| create_pattern | 空白图纸或完整 BeadPattern 新建，可设填充色、色卡、排版 |
| import_pattern | v1 / legacy JSON、源 HEX / MARD 选择、原始 JSON 与 SVG/PDF 附件归档 |
| preview_pattern_edit | 单格、全局换色、选区换色、选区填充预览 |
| commit_pattern_edit | 确认提交、原子修改、版本冲突和幂等保护 |
| update_pattern_layout | 色号、拼板编号、网格、坐标、单格大小、纸张和分页设置 |
| bind_pattern_palette | 更换完整色卡或绑定实际 MARD 221，验证已用色号 |
| get_pattern_revisions / diff_pattern_revisions | 版本历史和网格差异、分页 |
| restore_pattern_revision | 历史版本恢复成新版本，保留历史 |
| undo_pattern_edit / redo_pattern_edit | 持久化撤销与重做 |
| delete_pattern | 指定图纸及其历史、原始附件、导出记录删除 |
| export_pattern_svg / export_pattern_pdf / export_pattern_json | 固定版本下载 URL，SVG/PDF 选区、SVG 显示模式 |
| list_pattern_archives / get_pattern_archive | 原始上传附件列表和下载 URL，仅限关联图纸的 SQLite 档案 |
| get_pattern_export_records | 导出审计记录、分页 |

总计 26 个工具。画布缩放、平移、光标/选区显示属于前端临时视图；工具以精确选区读写覆盖其图纸操作，不远程控制浏览器界面。没有添加网站原本不存在的识别、镜像、裁切或自动绘图能力，也不提供管理员、登录凭据、环境配置或任意服务器文件工具。

## 写入流程

改格子先调用 preview_pattern_edit，返回统计、最多 100 格差异、是否截断及 confirmationToken；向用户展示预览并确认后，commit_pattern_edit 使用相同 patternId/request/token 提交。request 的 baseRevision、operations、expectedColor、idempotencyKey 均绑定确认凭据，不能替换操作。

新建、导入、排版、色卡、撤销、重做、恢复和删除：第一次调用不带 confirmationToken，只返回预览。经用户确认后再次用完全相同参数加 token 调用。排版和色卡预览包含真实差异；删除预览包含图纸身份及将删除的版本/附件数量。

确认凭据 5 分钟过期，绑定工具名、参数及当前版本摘要；旧版本、篡改参数或跨工具挪用被拒绝。已提交的同一凭据重试返回原结果，避免重复提交、重复撤销和重复新建。应用重启清空尚未提交的凭据，客户端必须重新预览。确认流程不能证明客户端真的征询了人类，MCP 写工具的 readOnlyHint=false / destructiveHint 注释用于客户端确认界面；服务端凭据用于绑定预览和防止误用，不代替身份认证。

## 访问模式与文件

当前生产 PUBLIC_ACCESS=true、网页和共享图库免登录。此更新沿用同一模式：发布后任何连接该公开 MCP 的客户端可以访问完整图纸，并通过预览/确认流程修改共享工作区。没有新增管理员密钥，也没有假设仅某个 ChatGPT 账号能够调用。若部署为已有的 token 保护模式，匿名 MCP 仍仅显示原来两个元数据工具；完整读写工具必须携带有效 Bearer 凭据，Cookie 不用于 MCP 授权。此版本未实现 OAuth、多用户或逐图纸权限。

所有工具输入都按 schema 验证；复用现有矩阵、色卡、操作和导入校验。常规 MCP 消息仍限制 16 KiB，导入/新建/批量修改/绑定色卡单条 tools/call 放宽至 24 MiB，与现有 API 总请求限制一致；原始 JSON 最大 16 Mi 字符，SVG/PDF 每个 8 MiB、最多两个。速率和 Origin/Host/协议校验保留。

导出工具返回固定 revision 的 ready_for_download 链接，在用户/客户端取链接时通过既有 API 渲染 SVG/PDF/JSON，并记录导出审计；不声称尚未下载的文件已经生成。CSV 返回实际文本，全图 CSV 另附固定版本下载链接，选区 CSV 返回选区实际文本。原始附件下载只查询 patternId + archiveId，不能访问任意文件路径或任意远程 URL。

## 实际测试

- TypeScript 与 Vite 构建通过；前端资源哈希仍为 index-C_KpPsje.js / index-Cb8tm2fV.css。
- 8 文件、94/94 Vitest 通过：既有 74 项加 20 项完整工作台测试。
- 8/8 Playwright 工作台流程通过，31.9 秒，包含导入、40,000 格、极简控件、画笔/选区/批量修改、SVG/PDF、持久化撤销重做。
- 官方 SDK 在真实 HTTP 回环完成新建、导入、修改确认、重复提交、完整 JSON、选区、统计 CSV、色卡、排版、撤销重做、历史恢复/差异、三个真实导出下载、原始附件下载、导出记录和确认删除。两张初始图纸保留，只删除了本次随机 ID 探针。
- 负向测试覆盖 token 过期、跨工具使用、改变参数、并发版本变动、未知参数、非法色卡、服务器错误过滤；受保护模式禁止匿名完整读取和写入。

本轮未在 Ubuntu 上运行新代码，也未上线完整工具；线上旧 MCP 及五项业务/Tunnel 只读检查正常。用户 ChatGPT 账号内工具选择和写入确认尚未验收。

## 待确认的生产变更与回滚

此前用户第 7 条要求：「生产合并、重启和发布须经我确认。」本次从只读变为完整读写，先交付代码、测试、PR 和源包，待确认后才执行以下步骤：

1. 合并当前 Pattern-web PR，按最终提交生成源包与 SHA-256。
2. 在 /var/backups/perler-cloud 下创建一致性 SQLite 与五表哈希、unit、环境配置、旧发布指针备份，凭据只保留在 root 私有备份。
3. 新 release ID 保持 YYYYMMDD-HHMMSS-mard221-workbench 格式；依现有 prepare-server.sh 构建、94 项测试和 REST 验收，备用端口仍 18050。运行 verify-workbench-mcp.mjs 的 --exercise-writes，只操作带随机 mcp-verification- 前缀的自建探针，再确认原始行哈希不变。
4. 现有 switch-server.sh 切换并验证编辑、导出和重启持久化，保持当前数据库、免登录、MARD 221、服务端口和网络配置。
5. 公网运行以下命令，逐项实际验收后更新生产记录；ChatGPT 连接 Refresh 后新对话，执行真实预览并让用户确认一次修改。

```powershell
node scripts/deploy/verify-public-mcp.mjs https://perler.cloud
node scripts/deploy/verify-workbench-mcp.mjs https://perler.cloud --exercise-writes
```

确认前回滚目标（当前发布）为 /opt/perler-cloud/releases/20261013-210554-mard221-workbench。发布备份内 previous-release.txt 记录实际切换前目标。回滚恢复该 unit 和发布指针，启动应用及既有 Tunnel，不覆盖数据库、不丢弃发布后的图纸修改；MCP 返回目前两个只读工具。确认凭据仅在内存，无数据库迁移。

官方参考：[连接与刷新](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。
