# Orion Lab · 边缘 AI 工作台

Orion Lab 在瑞莎 Orion O6N 上提供本地问答、项目文件读取、逐项审批写入、隔离检查与资源监控。一套 React 界面接入 Python 聊天桥接和 Pi Agent。浏览器通过设备地址访问，模型调用按范围经 AI Gateway 路由。

## 环境

| 用途 | 依赖 |
| --- | --- |
| 本地前端预览与构建 | Node.js ≥ 22.19（推荐 24 LTS）、npm、Python ≥ 3.11 |
| O6N 实机运行 | Debian 12 / ARM64、systemd 用户实例、python3-venv、curl、Bubblewrap、util-linux（flock、prlimit） |
| 完整推理 | AI Gateway、与 O6N 内核匹配的供应商驱动及后摩运行时、本地模型与审核服务。具体模型文件和供应商组件按各自许可取得 |

### 本地复现与检查

```bash
npm ci
npm run typecheck
npm test
npm run check:source
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r services/o6n-bridge/requirements-documents.txt
.venv/bin/python scripts/run-python-tests.py
npm run dev
```

访问 `http://127.0.0.1:17880/chat.html`。本地预览使用内置示例，真实问答和工具调用需要 O6N 后端。连接已部署的开发设备时，可设置 `O6N_DEV_API_TARGET`、`O6N_DEV_STATUS_TARGET` 与 `O6N_DEV_RESOURCES_TARGET`，仍需遵守目标设备的会话与访问配置。

## O6N 一键部署

以下命令在将承载应用的 O6N 上，用普通运行账号从仓库根目录执行。先准备下列外部依赖：

1. 在 O6N 部署并配置 AI Gateway，宿主回环 `13000` 提供网关 API。创建 Workspace、逻辑模型映射及输入 Block 规则并发布配置。为仅本地项目演示至少配置逻辑模型 `o6n-standard`，对应已启动的 Qwen3.5-9B 后摩推理服务 `17777`。本地上游通过桥接 `17791` 的 HTTPS 代理接入，Webhook 复用该 HTTPS 入口；网关信任部署方 CA。
2. 启动审核引擎（回环 `17793`）和适配器（回环 `17792`）。适配器参考 `services/o6n-bridge/guard_server.py`。需要 CPU、视觉或 Auto 判决选项时，按 [设备部署说明](docs/operations.md) 配置相应运行时和 unit。按需模型的 unit 名称以源代码模型注册表和 `deploy/o6n/` 模板为准。
3. 按 `deploy/o6n/settings.example.json` 生成运行账号私有的 `~/.local/state/o6n-smart-chat/settings.json`。填写真实 Workspace、Gateway Key、Webhook 等既有部署字段。将 TLS 服务证书和私钥放在该状态目录的 `tls/server.crt`、`tls/server.key`，文件权限设为 0600。TLS 证书的 SAN 应覆盖网关实际使用的代理地址。设置受信演示电脑地址，保留认证和策略校验。生产凭据仅在设备私有目录配置。
4. 确认设备能安装锁定的 npm 和 Python 依赖，或提前准备对应的可信镜像源与缓存。使用 SSH 登录正常的 systemd 用户会话。

```bash
bash deploy/o6n/deploy.sh
```

脚本安装锁定依赖，构建聊天、资源页和 Agent，在用户目录生成独立发布版本，注册并启动应用服务，检查健康接口。适用于已准备外部依赖、尚未安装 Orion Lab 应用的 O6N。已部署本作品的设备可直接使用下一节的命令。

### 已部署设备启动和验收

```bash
systemctl --user start o6n-smart-chat.service orion-agent.service model-benchmark-dashboard.service
curl -fsS http://127.0.0.1:13000/health
curl -fsS http://127.0.0.1:17790/api/health
curl -fsS http://127.0.0.1:17780/api/health
```

在浏览器打开 `http://<设备IP>:17790/#chat`，启用「仅本地」并选择本地 Qwen3.5-9B。导入 `deploy/o6n/demo-project`，读取代码并提出单文件修改，核对差异后单独审批写入和 Python 检查。资源页位于 `http://<设备IP>:17780/#resources`。健康接口确认服务响应，真实问答和审批需要单独验收。

## 目录

- `apps/console` · React 工作台与资源监控
- `apps/agent-server` · Pi 会话、项目和审批 API
- `packages/` · 通用契约、路由、网关适配、工具执行和 UI
- `services/` · Python 聊天桥接、审核适配和系统资源采集
- `deploy/o6n/` · 部署脚本、设备配置样例和演示项目
- [架构与权限](docs/architecture.md)、[统一 Agent](docs/unified-agent.md)、[文档文字输入](docs/document-text-input.md)

## 许可

Orion Lab 自研代码采用 MIT 许可，见 [LICENSE](LICENSE)。`packages/gateway-adapter` 是 Orion Lab 编写的 AI Gateway API 适配层。AI Gateway 是独立闭源组件，由部署方单独取得、部署和配置。

其他第三方组件遵循各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。模型权重、芯片运行时、凭据和私有实测数据由部署方独立管理。

