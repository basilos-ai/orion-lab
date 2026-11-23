# Orion Lab 工作约定

- 这是可开源的 MIT monorepo。账号、密码、密钥、OAuth、证书私钥、真实测试数据与部署证据不得加入源码。
- `apps/console` 管页面，`packages/ui` 管基础封装，`packages/contracts` 管跨端契约。Pi、模型路由、AI Gateway、工具隔离分别在独立包中维护。
- 保留 17780、17790、原聊天 storage key、模型功能与历史测试 payload。历史测试数据在项目外层“模型测试归档”统一保存，不进入参赛发布目录；examples 保持空示例。
- AI Gateway 是外部依赖；不修改用户的 AI Gateway 源码，不冒用 Codex / Claude 来源，不直接改其数据库。原生 Pi 来源未支持时明确显示能力缺口。
- Agent 默认只读。写入、检查逐次审批并绑定参数和旧文件 SHA；不接受自由 shell、任意主机路径或 Docker socket。
- 改动后执行 `npm run typecheck`、`npm test`、Python 单测、`npm run check:source`、`npm run build`。接口、浏览器、主题、移动端、隔离执行分别留证据，不把单元测试当成浏览器验收。
- 架构、启动命令、重要决策与限制同步 `docs/`。不未经用户授权推送仓库或发布服务。
