# ChatGPT / MCP 后续接入

已实现 `packages/mcp-adapter` 的传输独立适配边界，及 `apps/api/src/mcp-boundary.ts` 到现有业务服务的连接。当前不会启动 MCP 网络端点、登录 ChatGPT 账户或假定 ChatGPT Work 有外部工具权限。

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

未来步骤：选用当时 ChatGPT Work 实际支持的连接机制，补充 MCP SDK 传输、OAuth/账户身份、项目 ACL、工具输入 Schema 以及授权文件资源。写操作必须延续先预览再确认的工作流，并使用 baseRevision、expectedColor 和幂等键。远程 MCP 不应通过前端 token/localStorage 传递服务端密钥。
