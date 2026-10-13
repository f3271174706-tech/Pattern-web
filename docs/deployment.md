# perler.cloud 服务器部署

2026-10-13 更新：极简编辑界面，新增色号和拼板编号开关，颜色按使用情况与字母分组。此前已按用户要求关闭登录密钥，支持旧版 MARD 网格 JSON 的显式转换导入。用户明确选择替换现有 `perler.cloud`，保留旧网站与数据为回滚点。

- 公网入口：`https://perler.cloud/`。
- 发布目录：`/opt/perler-cloud/releases/20261013-013310-mard221-workbench`。
- 当前软链接：`/opt/perler-cloud/current`。
- 运行服务：`perler-cloud.service`，非 root 用户 `perler-cloud`，active / enabled。
- 运行环境：Ubuntu 24.04 / Node.js 22.23.2；未安装 Docker、Nginx 或 PM2。
- 源站仅监听 `127.0.0.1:18040`；使用已有 Cloudflare Tunnel，metrics `127.0.0.1:20243`，4 条连接。
- 新工作台数据库：`/var/lib/perler-cloud/workbench/workbench.sqlite`。
- 受限环境文件：`/etc/perler-cloud/workbench.env`，`root:perler-cloud 0640`。
- `PUBLIC_ACCESS=true`：直接打开工作台，前端与 API 无需登录密钥或会话 Cookie。保留的旧密钥不参与认证。
- 本次回滚备份：`/var/backups/perler-cloud/20261013-013310-mard221-workbench`，保留更新前 service、配置和工作台数据。首次替换旧站的备份仍在 `20261012-150223-mard221-workbench`。
- 旧发布保留：`/opt/perler-cloud/releases/20260818-150003-server-gallery`。

## 色卡与数据

默认两张图纸均使用用户的 MARD 221 色卡。Excel 的 221 个色号与 HEX 已逐项比对，缺失、多余和错误项均为 0。公网浏览器再次核对了 221 个色块的实际 CSS 颜色，全部一致。

旧站的 MARD291 图库、识别与照片相关功能不迁移到新系统；原发布与原数据保留用于回滚。新系统以导入 JSON 为权威数据，不从旧图片推测珠子数据。

## 10 月 13 日界面更新

移除精确定位面板，颜色选择启用画笔后直接在画布绘制。已用颜色单独展示实际用量；剩余色按首字母分组，支持展开、搜索和按数字自然排序，所有色号与 HEX 保持原样。移除口号、重复标题、存储实现说明和底部重复信息，保留图纸标题、修订、尺寸、豆数、颜色数、空格数与当前色卡。

新增「显示色号」「拼板编号」两个独立工具栏开关，立即保存为排版修订，刷新后保留，布局导出使用相同设置。`layout.board.showLabels` 为可选布尔字段，缺省关闭，兼容已有 JSON；不修改矩阵、统计分区或原始档案。

## 10 月 12 日导入更新

导入器识别 `schema_version: 1` 的正面 MARD 网格，检查矩阵、已用色号和坐标声明，补充 BeadPattern v1 标识及默认排版。显示色值模式可选指定 Excel 色卡或原文件 HEX，导入前展示逐项差异；源网格逐格保留。服务器重做转换并核对输入，原始 JSON 完整归档，转换模式和色值差异进入修订记录。内部编辑、导出和 MCP 仍只接受严格 BeadPattern v1。

用户提供的 `pattern.json` 为 190×130、12,744 颗、43 色；其中 20 个色号的 HEX 不同于指定 Excel。单独转换文件已保存在用户素材目录，源文件保持原样。

## 10 月 13 日验证

2026-10-13 09:37（Asia/Shanghai）公网 Edge 验证通过：精确定位和重复说明已移除，图纸信息保留；已用色和剩余色完全覆盖且无重复，剩余面板分组与首字母一致；221 个实际 CSS 色值与原色卡一致。两项显示开关生成排版修订、刷新保留，SVG 跟随拼板编号设置；切换前后网格逐格一致。临时测试项目删除后，原有 3 个项目保留。记录与截图在 `output/deploy/minimal-ui-verification.json`、`minimal-workbench-live.png`。

Windows 与服务器 44 项逻辑测试通过，8 项浏览器流程通过，正式服务重启后的修改和撤销状态保留。首次公网请求遇到短暂 502，同时多条已有 Tunnel 连接掉线；代理与 Tunnel 自动重连后，公网完整验收通过，未修改代理、DNS 或隧道配置。源站五项健康检查均为 200，SQLite 完整性正常，systemd 失败单元为 0。

## 10 月 12 日验证

2026-10-12 23:45（Asia/Shanghai）：Windows 与服务器各 44 项逻辑测试通过；6 项已有浏览器用例通过，新兼容导入用例修正测试的统计查询后单独重跑通过（合计 7 项）。正式服务无 Cookie、无密钥的接口请求成功。公网全新 Edge 会话直接打开工作台，上传用户实际 `pattern.json`，展示 20 项 HEX 差异，逐格核对全部 24,700 格不变，统计 12,744 颗 / 43 色，色卡与指定 Excel 快照完全一致，原始 JSON 逐字归档，刷新后仍可读取。测试只删除新建的临时图纸，原有项目保留。记录见 `output/deploy/public-import-verification.json`。

正式服务重启后的 v2 和撤销状态验证通过，SQLite 完整性正常。五项回环健康检查均为 200，五个 Tunnel 各 4 条连接，systemd 失败单元为 0。

## 首次部署验证

1. 服务器独立备用端口 `18050` 构建、37 项逻辑测试和完整 REST 冒烟验证通过。
2. 正式端口上测试认证、原子编辑、409、幂等、预览、历史恢复和矢量文件输出。
3. 保存临时图纸至 v2，重启 systemd 后仍保持 v2、H2 单格和撤销状态；验证后删除临时测试图纸。
4. 通过真实 HTTPS 浏览器登录、核对所有色块、修改临时图纸、下载 SVG/PDF、刷新并查询服务器数据，全部成功。
5. SQLite `integrity_check=ok`。最终保留两个默认 MARD 示例。
6. 其他四个业务回环健康检查仍为 200；五个 Tunnel 各 4 条连接，systemd 失败单元为 0。

生产服务增加 `Wants=cloudflared-perler-cloud.service`，配合既有 Tunnel 的 `Requires=perler-cloud.service`，避免显式停止/启动应用后 Tunnel 未启动。已经实测重启应用后 Tunnel 自行恢复。未改动 DNS、SSH、UFW、Mihomo 或透明代理配置。

首次切换验证曾因清理脚本给无请求体 DELETE 设置 JSON Content-Type 而触发保护性回滚；请求格式已修复并重新通过。Tunnel 与应用启动关联也已修复并实际验证。最终公网验证记录见 `output/deploy/public-verification.json`。

## 维护与回滚

日常检查：

```bash
systemctl status perler-cloud.service cloudflared-perler-cloud.service --no-pager
curl -fsS http://127.0.0.1:18040/api/v1/health
curl -fsS https://perler.cloud/api/v1/health
journalctl -u perler-cloud.service --since '-10 min' --no-pager
```

回滚到本次更新前的工作台（不删除或覆盖数据库）：

```bash
systemctl stop perler-cloud.service
cp -a /var/backups/perler-cloud/20261013-013310-mard221-workbench/perler-cloud.service /etc/systemd/system/perler-cloud.service
ln -s /opt/perler-cloud/releases/20261012-154305-mard221-workbench /opt/perler-cloud/current.rollback
mv -Tf /opt/perler-cloud/current.rollback /opt/perler-cloud/current
systemctl daemon-reload
systemctl start perler-cloud.service
systemctl start cloudflared-perler-cloud.service
```

执行回滚前应另做当前 SQLite 在线备份。更新前的工作台使用同一数据库；旧站图库使用不同数据结构，不自动转换。若回滚到不认识 `board.showLabels` 的版本，须先为该可选字段提供兼容校验，避免旧编辑器拒绝新修订；不要覆盖数据库来删除更新后的用户修改。当前网站运行依赖服务器的 systemd、Mihomo 和 Tunnel，不依赖维护电脑保持开机。
