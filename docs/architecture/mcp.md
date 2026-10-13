# Pattern-web MCP 接入

现有 Fastify 服务已实现 `POST /mcp`，使用官方 `@modelcontextprotocol/sdk` 1.32.1 的 Stateless Streamable HTTP JSON 传输。2026-10-13 经用户确认已部署并通过公网及官方 SDK 客户端验证；用户 ChatGPT 账号的安装与对话调用尚未验证。发布记录见 `docs/mcp-production-report.md`。

公开工具为 `list_example_patterns`（limit 1..100、offset 非负安全整数）和 `get_example_pattern`（list 返回的 id）。按站点所有者“要公开所有图纸”的明确要求，目录读取 SQLite 工作台所有已保存图纸的当前版本，包含内置、导入、新建和以后上传的图纸，删除后不再返回，不需重启同步。

返回字段明确限定为 id、标题、当前修订号、尺寸、豆数、颜色数、色卡 id/版本、元数据链接及公开 SVG 链接。不返回矩阵、原始上传档案、source、密钥、Cookie、私有路径或图像字节；匿名 MCP 保持只读。所有图纸均公开，没有逐图纸私有开关。

新增 `/api/v1/examples`、`/api/v1/examples/{id}`、`/api/v1/examples/{id}/preview.svg` 使用同一公开目录。现有工作台 API 和界面保留。

通知和客户端响应返回空 202，GET / DELETE 返回 405。校验 Origin、Host、Accept、Content-Type、协议头、16 KiB 上限和速率。支持 2025-11-25、2025-06-18、2025-03-26；只有旧版 2025-03-26 接受最多 32 条消息的 batch。未实现 2026-07-28 新协议，不宣称自动兼容。

Origin 允许部署站点、https://chatgpt.com、https://chat.openai.com 和无 Origin 的服务器客户端，拒绝 null 和伪造域名。每 IP 每分钟限 360 条 RPC；不信任代理时回环代理的调用共享限额。

## ChatGPT 连接：服务已上线，账号内执行

1. 打开 ChatGPT Plugins，选择加号 → Add custom MCP server。
2. 名称填 Pattern-web，Server URL 填 `https://perler.cloud/mcp`。
3. 选择 No authentication，不填写管理员密钥。
4. 检查提示，创建连接，确认两个只读工具，再安装插件。
5. 已添加旧连接的用户先打开连接并 Refresh 工具信息，再新建对话输入 @ 选择插件，先列出所有已保存图纸，再用返回的 id 查看一张图纸。

账号和工作区政策可能限制自定义服务器入口；服务上线不等于账号已安装或已连接。[官方连接说明](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[认证选项](https://developers.openai.com/api/docs/guides/custom-mcp-server)、[传输协议](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。发布方案见 `docs/mcp-deployment-plan.md`；上线后执行 `node scripts/deploy/verify-public-mcp.mjs https://perler.cloud`。

## 本地适配器：以下工具未公开

`packages/mcp-adapter` 和 `apps/api/src/mcp-boundary.ts` 仍是带 principal/scopes 的本地业务边界。匿名 MCP 只读取当前图纸元数据和预览，没有接入这些完整矩阵、档案与写入能力。

| 工具                  | 权限           | 调用现有能力         |
| --------------------- | -------------- | -------------------- |
| create_pattern        | patterns:write | 校验并导入 JSON      |
| get_pattern           | patterns:read  | 当前/历史快照        |
| get_pattern_stats     | patterns:read  | 精确矩阵统计         |
| preview_pattern_edit  | patterns:read  | 无副作用预览         |
| commit_pattern_edit   | patterns:write | 原子提交、409、幂等  |
| export_pattern_svg    | patterns:read  | 指定版本 worker 输出 |
| export_pattern_pdf    | patterns:read  | 指定版本 worker 输出 |
| get_pattern_revisions | patterns:read  | 不可变历史           |

输入 `{patternId,revision,pattern,request}` 根据工具选取，数据结构复用 BeadPattern v1 和 EditRequest。工具 schema 应在实际 MCP SDK 上注册时复用 `/api/v1/schema.json` 与 OpenAPI 的 EditRequest，避免两套协议漂移。二进制 PDF 在实际传输层应映射成授权文件资源或临时签名 URL，而不是无界 base64 文本。

每次调用由传输层提供可信 principal 与 scopes。适配器验证工具权限并调用项目访问回调。读取权限不能提交修改；写入权限必须显式授权。测试已覆盖权限拒绝和共享服务修改。

以后增加私有图纸或写入能力时，需要 OAuth/账户身份、项目 ACL 和授权文件资源。写操作必须延续先预览再确认的工作流，并使用 baseRevision、expectedColor 和幂等键。远程 MCP 不应通过前端 token/localStorage 传递服务端密钥。
