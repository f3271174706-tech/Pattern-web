# Pattern-web MCP 生产记录

2026-10-13，经用户明确确认后合并 [Pattern-web PR #1](https://github.com/f3271174706-tech/Pattern-web/pull/1)，没有部署废弃的 Perler.fzp.me。

## 代码与部署

- 部署代码：main 合并提交 `e2a90f101f560ec4552965ff261729b614f2ed91`，MCP 实现提交 `a63209109093b70f42cc7e13369e1ae5496c692a`。
- 发布：`/opt/perler-cloud/releases/20261013-144501-mard221-workbench`；`/opt/perler-cloud/current` 已指向该目录。
- 发布包 SHA-256：`0be9ecefbe582f302738449e631fb545bc8f1582f7deb65cba72972a172058a1`。
- 原 Fastify / React 工作台、Node 22.23.2、systemd 非 root 服务、127.0.0.1:18040 和持久 SQLite 路径保留，无数据库迁移。PUBLIC_ACCESS=true，登录仍关闭。
- 新增 POST `/mcp` 与 `/api/v1/examples`、`/api/v1/examples/{id}`、`/api/v1/examples/{id}/preview.svg`；原 `/api/v1` 工作台 API 保留。未恢复废弃图库服务器或旧 `/api/examples` 路由。
- 仅公开 `list_example_patterns` 与 `get_example_pattern`，返回两张内置 MARD 示例元数据；不访问 SQLite 用户图纸、上传原始档案或服务端凭据。工作台编辑工具未公开给匿名 MCP。
- Origin / Host、JSON-RPC、HTTP 内容协商、协议版本、输入大小与速率、错误信息校验已测试；使用官方 SDK Stateless Streamable HTTP，不要求 OAuth、管理员密钥或 Cookie。
- 未修改 Tunnel、DNS、SSH、Mihomo、UFW。仅更新应用发布与按既有依赖重启，Tunnel 已恢复连接。

## 验证结果

本地与 Ubuntu 均 73/73 Vitest，通过 TypeScript/Vite 构建；8 项本地 Playwright 流程通过。生产备用服务与正式服务修改/导出/重启持久化探针通过并清理。MARD 221 映射逐项相符。

公网 `https://perler.cloud/mcp` 的 initialize、通知 ACK、tools/list、两项 tools/call、公开 SVG 和 Origin 拒绝均通过。另用官方 SDK 客户端通过公网 HTTPS 成功连接并调用两个工具。直接 GET `/mcp` 返回 405 是本服务不提供独立 SSE 流的预期行为；应使用 MCP 客户端的 POST 初始化。

Edge 真实网站首页、图纸信息和极简界面控件正常，无脚本异常，3 张图纸无登录可读。部署前后五张 SQLite 表原始行哈希一致，integrity_check=ok。五项业务健康检查均 200，五个 Tunnel 各 4 条连接，失败 systemd 单元为 0。

公网传输检查于 `2026-10-13T06:53:37.592Z` 完成；官方 SDK 与 Edge 复核记录时间为 `2026-10-13T11:25:46.694Z`，两次验证均通过。

验证器增加 SVG Content-Type 与内容断言，并把备用服务的预览验证请求发送到备用服务，避免将旧站 SPA 的 200 误判为预览成功。备用检查首次因沿公开绝对 URL 请求时服务器出站超时而失败；修正验证目标后通过，公网检查仍走公开 HTTPS。该变化属于验收脚本，生产应用代码仍为上面的部署提交。

## 用户 ChatGPT 内剩余操作

当前工具不能替用户账号创建自定义 MCP 连接；尚未声称账号已安装或对话调用成功。

1. 打开 [ChatGPT Plugins](https://chatgpt.com/plugins)，加号 → Add custom MCP server。
2. 名称 `Pattern-web`，描述 `读取拼豆工作台公开示例的尺寸、豆数、色卡信息与预览链接`。
3. Server URL：`https://perler.cloud/mcp`；Authentication：No authentication。
4. 阅读提示并创建，确认发现两个只读工具，再安装。
5. 新建对话输入 `@` 选择 Pattern-web，发送「列出公开拼豆示例」，应得到两张示例；再发送「查看 mard-demo-3x2 的尺寸和豆数」，应得到 3×2、5 颗豆。

账号或工作区政策可能限制入口，具体以该账号页面为准。[官方连接步骤](https://developers.openai.com/plugins/deploy/connect-chatgpt)。本轮服务端连接已验证，账号内上述最终验收仍待执行。

## 回滚

切换备份：`/var/backups/perler-cloud/20261013-144501-mard221-workbench`；另有切换前一致性 SQLite 备份与五表哈希记录：`/var/backups/perler-cloud/20261013-144501-mard221-workbench-preflight`。目录仅 root 可读，凭据不进入 Git。

回滚目标为旧工作台 `/opt/perler-cloud/releases/20261013-013310-mard221-workbench`，通过已验证维护入口登录服务器执行：

```bash
systemctl stop perler-cloud.service
cp -a /var/backups/perler-cloud/20261013-144501-mard221-workbench/perler-cloud.service /etc/systemd/system/perler-cloud.service
ln -s /opt/perler-cloud/releases/20261013-013310-mard221-workbench /opt/perler-cloud/current.rollback
mv -Tf /opt/perler-cloud/current.rollback /opt/perler-cloud/current
systemctl daemon-reload
systemctl start perler-cloud.service
systemctl start cloudflared-perler-cloud.service
curl -fsS http://127.0.0.1:18040/api/v1/health
```

不覆盖现有 SQLite，不丢弃部署后的编辑。此回滚只撤回应用发布，MCP 将不再可用；未在正常生产服务上额外执行回滚演练。
