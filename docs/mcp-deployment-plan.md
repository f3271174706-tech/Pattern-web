# Pattern-web MCP：待确认的生产变更

目标仓库为 [Pattern-web](https://github.com/f3271174706-tech/Pattern-web)。废弃的 Perler.fzp.me 和其 PR #1 不参与部署；旧仓库审核草稿未合并、未推送、未部署。

只读检查确认：当前发布 `/opt/perler-cloud/releases/20261013-013310-mard221-workbench`，perler-cloud.service 使用 Node 22.23.2，以 perler-cloud 用户监听 127.0.0.1:18040。SQLite 位于独立的 `/var/lib/perler-cloud/workbench/workbench.sqlite`。PUBLIC_ACCESS=true，应用和 Tunnel active，Tunnel 4 条连接。

当前发布没有 MCP 路由；GET /mcp 可能返回 SPA HTML，并非 MCP。保留当前 `/api/v1` API、图纸、SQLite 和原始档案，不恢复废弃项目。

## 将发生的变更

- 合并经用户确认的 Pattern-web PR，创建独立新发布，使用锁定依赖构建。
- 新增官方 SDK、MCP 路由与三条公开示例 GET 路由；公开范围仅两张内置 MARD 示例。
- 服务、端口、环境文件、关闭登录状态、数据库路径保留；无数据库迁移。
- 不修改 Tunnel、DNS、Mihomo、SSH 或 UFW；既有入口直接转发 /mcp。
- 重启前备份发布指针、systemd 和数据；已有依赖可能导致 Tunnel 一起重连，之后检查 HTTPS。
- 不删除数据库、上传档案、用户图纸或旧发布。

## 确认后执行

使用本会话已验证的维护入口和主机校验。发布 ID 格式为 `YYYYMMDD-HHMMSS-mard221-workbench`；替换占位符为实际新 ID 和生成的 SHA-256，不能复用旧目录。

```powershell
python scripts/deploy/package-source.py
scp -i 'C:\Users\32711\.ssh\id_ed25519' -P 51918 -o 'HostKeyAlias=[103.236.92.3]:51918' -o HostKeyAlgorithms=ssh-ed25519 -o StrictHostKeyChecking=yes 'output/deploy/workbench-source.tar.gz' 'root@103.236.92.32:/tmp/workbench-mcp-reviewed.tar.gz'
ssh -i 'C:\Users\32711\.ssh\id_ed25519' -p 51918 -o 'HostKeyAlias=[103.236.92.3]:51918' -o HostKeyAlgorithms=ssh-ed25519 -o StrictHostKeyChecking=yes root@103.236.92.32 'bash /opt/perler-cloud/current/scripts/deploy/prepare-server.sh /tmp/workbench-mcp-reviewed.tar.gz <release-id> <sha256>'
ssh -i 'C:\Users\32711\.ssh\id_ed25519' -p 51918 -o 'HostKeyAlias=[103.236.92.3]:51918' -o HostKeyAlgorithms=ssh-ed25519 -o StrictHostKeyChecking=yes root@103.236.92.32 'bash /opt/perler-cloud/releases/<release-id>/scripts/deploy/switch-server.sh <release-id>'
node scripts/deploy/verify-public-mcp.mjs https://perler.cloud
```

prepare 脚本执行服务器 build、Vitest、REST/SVG/PDF 检查；备用服务使用同一持久数据库，只创建/清理自己的探针，这也是待确认的服务器写操作。本轮没有上传发布包、创建备用服务、修改生产配置或重启生产服务。

## 回滚

备份为 `/var/backups/perler-cloud/<release-id>`。恢复原 unit 和记录的旧发布，不覆盖现有数据库，不丢弃发布后用户修改：

```bash
systemctl stop perler-cloud.service
cp -a /var/backups/perler-cloud/<release-id>/perler-cloud.service /etc/systemd/system/perler-cloud.service
ln -s "$(cat /var/backups/perler-cloud/<release-id>/previous-release.txt)" /opt/perler-cloud/current.rollback
mv -Tf /opt/perler-cloud/current.rollback /opt/perler-cloud/current
systemctl daemon-reload
systemctl start perler-cloud.service
systemctl start cloudflared-perler-cloud.service
```

回滚移除 MCP 路由，现有图纸格式和数据仍兼容。上线后验证 initialize、tools/list、两个 tools/call、原编辑/导出流程，再在用户 ChatGPT 账号内添加 No authentication 自定义连接。确认前不声称线上 MCP 或 ChatGPT 已连接。
