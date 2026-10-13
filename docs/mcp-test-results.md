# Pattern-web MCP 验证记录

2026-10-13，本地 Windows / Node 22.22.2：

- TypeScript 与 Vite 构建通过，前端仍为现有工作台，未改前端文件。
- 新增 29 项 MCP 测试通过：初始化协商、id=0、工具白名单、分页、输入错误、未知工具、通知/客户端响应、JSON-RPC 错误、旧版 batch / 现代 batch 拒绝、Origin / Host / CORS、Accept / 版本 / 大小上限、速率、错误信息过滤和空 PUBLIC_ORIGIN。
- 官方 SDK 客户端通过真实回环 HTTP socket 完成 initialize、tools/list 和两个 tools/call。
- 8 项现有 Playwright 流程通过，包含旧版 JSON 导入、极简开关、40,000 格性能检查、编辑与 SVG/PDF 输出。
- 生产依赖 `npm audit --omit=dev`：0 个已报告漏洞。

发现并修复：SDK 收到缺少 params 的 initialize 时产生错误类型不正确，增加请求结构校验以返回 -32602；本地环境 PUBLIC_ORIGIN 为空字符串时启动失败，改为空值回退并增加回归测试。未放宽或移除原有断言。

本地 29 项新增测试与 44 项既有测试共 73 项，全量运行全部通过（Vitest：7 个测试文件，5.51 秒），TypeScript 检查通过。用户确认部署后，同样的 73 项测试在 Ubuntu / Node 22.23.2 全部通过（7 个文件，16.27 秒），服务器 TypeScript 与 Vite 构建通过。

## 公网只读观察

2026-10-13 14:23（Asia/Shanghai），全新 Edge 会话：站点首页和 `/api/v1/health` 为 200；GET `/mcp`、POST initialize 均返回 200、`text/html`。这些是 SPA 回退内容，不能作为 MCP 成功证据。现有生产发布未更换，MCP 尚未上线；未安装或连接用户 ChatGPT 插件。

## 发布后的实测

2026-10-13 用户确认后，发布 `20261013-144501-mard221-workbench`：

- `verify-public-mcp.mjs https://perler.cloud` 全部通过：HTTPS initialize、空 202 通知 ACK、tools/list、两项 tools/call、SVG 类型与内容、恶意 Origin 403、无需 Cookie/会话/管理员密钥。
- 官方 SDK 1.32.1 Client 与 StreamableHTTPClientTransport 通过公网 HTTPS 完成连接和两项工具调用。
- Edge 真实工作台首页 200、无登录要求、3 张图纸可读；图纸信息、色号/拼板编号开关及已用/剩余颜色栏存在，无精确定位栏；浏览器脚本异常为 0。
- 备用服务及生产服务 REST 修改、幂等、冲突、撤销/重做、恢复、统计、CSV、向量 SVG/PDF 通过；重启后临时图纸 revision 2 与撤销历史持久化通过，探针已删除。
- 对比部署前一致性快照，SQLite 五张表的全部原始行哈希不变，3 张图纸保留，integrity_check=ok。
- 五项业务健康检查均 200，五个 Tunnel 均 4 条连接，无失败 systemd 单元。

用户 ChatGPT 账号尚未添加/安装或调用插件；服务验证不能代替该账号内的最终对话验收。详见 `docs/mcp-production-report.md`。
