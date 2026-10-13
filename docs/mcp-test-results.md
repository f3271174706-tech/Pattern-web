# Pattern-web MCP 验证记录

2026-10-13，本地 Windows / Node 22.22.2：

- TypeScript 与 Vite 构建通过，前端仍为现有工作台，未改前端文件。
- 新增 29 项 MCP 测试通过：初始化协商、id=0、工具白名单、分页、输入错误、未知工具、通知/客户端响应、JSON-RPC 错误、旧版 batch / 现代 batch 拒绝、Origin / Host / CORS、Accept / 版本 / 大小上限、速率、错误信息过滤和空 PUBLIC_ORIGIN。
- 官方 SDK 客户端通过真实回环 HTTP socket 完成 initialize、tools/list 和两个 tools/call。
- 8 项现有 Playwright 流程通过，包含旧版 JSON 导入、极简开关、40,000 格性能检查、编辑与 SVG/PDF 输出。
- 生产依赖 `npm audit --omit=dev`：0 个已报告漏洞。

发现并修复：SDK 收到缺少 params 的 initialize 时产生错误类型不正确，增加请求结构校验以返回 -32602；本地环境 PUBLIC_ORIGIN 为空字符串时启动失败，改为空值回退并增加回归测试。未放宽或移除原有断言。

本地 29 项新增测试与 44 项既有测试共 73 项，全量运行全部通过（Vitest：7 个测试文件，5.51 秒），TypeScript 检查通过。本轮未在 Ubuntu 生产服务器上运行新代码测试。

## 公网只读观察

2026-10-13 14:23（Asia/Shanghai），全新 Edge 会话：站点首页和 `/api/v1/health` 为 200；GET `/mcp`、POST initialize 均返回 200、`text/html`。这些是 SPA 回退内容，不能作为 MCP 成功证据。现有生产发布未更换，MCP 尚未上线；未安装或连接用户 ChatGPT 插件。

用户确认发布后，运行 `scripts/deploy/verify-public-mcp.mjs` 验证 HTTPS initialize、通知 ACK、tools/list、两项 tools/call、SVG 链接和 Origin 拒绝，并再次验证工作台编辑/导出。不能用本地测试代替线上连接结果。
