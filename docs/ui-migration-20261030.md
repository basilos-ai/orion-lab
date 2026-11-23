# UI / UX 优化迁入与本地验收

日期：2026-10-30。来源：用户维护的 O6N-web-test 优化副本。目的：把已完成的资源监控、聊天和共用界面优化迁回本项目，继续在同一份源码上维护。此次仅本地迁移、构建与验收，未部署、未推送、未重启设备服务。

后续发布状态：用户在完成本地验收后已授权上线，现已发布设备静态前端。线上检查中发现并修复了严格 CSP 下的弹窗滚动样式兼容问题，随后重新验收发布；实现见 [CSP 适配](csp-modal-compatibility.md)。本记录下文保留迁入阶段的历史结论，最新发布与回滚流程见 [运维说明](operations.md)，具体设备发布回执存放在项目外层部署记录。

## 基线与迁移范围

- 基线提交：`5dcc573e1c9341437a27f8b5c67a0c6a95b1ab34`，包含通过源码边界检查的 185 个文件。
- 工作分支：`ui/basilos-migration-20261030`。基线与迁移结果分别使用本地标签 `ui-baseline-20261030`、`ui-basilos-20261030` 定位。
- 另存字节级源码备份与逐文件 SHA-256 清单：`.runtime/ui-migration-20261030/baseline.zip`、`manifest.json`；它们属于本地恢复资料，不进入源码提交。
- 按明确的文件清单迁入 92 个新增或修改文件，再补充本记录和 README 链接。未用副本覆盖整个工程。

| 范围 | 结果 |
| --- | --- |
| 前端与组件 | 迁入 apps/console/src、Harness 新组件及必要主题样式，保留 React 19、TypeScript、Vite、Tailwind 和 Radix UI |
| 共用框架 | Basilos V2 侧栏、桌面收起、移动抽屉、主题色与舒适 / 紧凑密度设置 |
| 资源监控 | Recharts 趋势、连续采样窗口、纵轴自适应、指标卡、设备分组、进程面板和统一操作菜单 |
| 智能对话 | 侧栏顶部与搜索、空白对话复用、取消草稿分组、授权状态说明，以及按钮、弹层和输入区适配 |
| 依赖与来源 | 同步必要 package.json、package-lock.json、许可及组件来源记录；Basilos 配置不复制来源工程的 identity |
| 开发路由 | Vite 仅在开发服务模式设置 /chat.html 与 / 的本地跳转，/api/resources 代理到资源服务；生产端口与显式公开配置规则不变 |

55 个受保护文件逐字节校验保持原样，包括 services、Agent 服务、共享契约、模型路由、工具执行、AI Gateway 适配、deploy、公开配置示例、根 package.json、既有 Harness 检查配置和部署打包脚本。原聊天 storage key 与权限边界保持。

迁入的主题 CSS 仅清理了文件末尾多余空行以通过 Git 空白检查，样式规则保持不变；回归脚本的历史重命名前置条件另作下述适配。

副本最后一轮提出但尚未实现的聊天首屏进一步精简、全部未发送输入的离开保护、完整服务器历史正文搜索等建议，不计入此次已交付成果。未复制 node_modules、构建产物、私有配置、会话数据或副本项目身份。

## 检查与证据

所有依赖安装和项目检查均在仓库根目录执行，使用 Node.js 24.19.0。首次 Python 检查受 Windows 沙箱回环网络和私有状态目录权限限制；之后通过项目内的临时 home 夹具运行，不更改后端源码或读取真实配置。

| 检查 | 验收范围与证据 |
| --- | --- |
| 类型检查 | 通过，覆盖 console 与 agent-server；`.runtime/ui-migration-20261030/typecheck.log` |
| JavaScript | 55/55 通过；`.runtime/ui-migration-20261030/javascript.log` |
| Python | 49/49 通过：45 项桥接测试和 4 项采集契约测试；Windows 上只为契约测试提供 Linux 导入常量，不代表已运行 Linux 实机采集验收；`python-isolated.log` |
| 源码边界 | 通过，232 个文件；空示例和凭据 / 开发者路径边界 |
| 完整构建 | 通过，React 两入口与 Agent 本地产物；`build.log` |
| 页面回归 | 128/128 通过，无未捕获页面错误；明暗主题、320 / 390px 与桌面、图表断采与真实零值、键盘、焦点、无障碍、聊天流式与停止；`.harness/runs/ui-migration-20261030/browser-final/report.json` |
| 项目空间 | 16/16 通过，真实本地 Node API，使用隔离项目目录；`.harness/runs/ui-migration-20261030/projects/report.json` |
| 本地预览 | 4/4 通过，两页面 × 桌面 / 手机，只读访问实际设备；`.runtime/ui-migration-20261030/preview-smoke.json` |

首轮完整页面回归有一项旧测试假设空白新对话必定出现在历史列表，与此次已迁入的“取消草稿占位”行为冲突。已将该测试的前置条件改为明确选择一条真实历史，再重命名另一条历史；保留原本“重命名不得改变当前选择”的断言。专项通过后重新执行完整回归。该修正只涉及测试夹具，不改变界面功能。

截图与自动化证据在 `.harness/runs/ui-migration-20261030/` 和 `.runtime/ui-migration-20261030/`，不提交真实设备截图或运行状态。迁入的 2026-10-28 / 29 来源记录为副本的历史证据，不能替代本次验收。

## 本地验收入口与限制

- 资源监控：<http://127.0.0.1:17882/?theme=light#resources>
- 智能对话：<http://127.0.0.1:17882/chat.html?theme=light#chat>

预览仅监听 127.0.0.1:17882。该端口与常用的副本开发端口 17880 分开；它不是线上部署入口。资源 / 健康接口代理分别沿用设备的 17780 / 17790，实际设备采集空闲时会先返回保留快照，再恢复实时数据。无指标或过期的后摩数据继续显示 N/A。

UI 迁入验收当时，当前电脑的设备会话接口返回 **403**。聊天页正确提示“此设备尚未获得聊天权限”，保留输入并禁用发送。当时没有绕过授权，没有运行线上模型请求或修改线上项目。真实发送、真实模型输出与实机审批不在该阶段通过范围；这些交互只完成隔离夹具和本地 Node API 验证。

后续授权复核（2026-10-30）：上段记录的是 UI 迁入时的状态。用户随后授权按既有设备白名单机制处理，现已解除当前电脑的 403，并通过本地页面完成真实本地模型的两轮流式对话、上下文与刷新恢复验收。没有发布新代码；只在设备私有配置中追加当前电脑 IP，并在空闲时重启聊天桥接。机制见[本地聊天授权说明](local-chat-authorization.md)，具体配置备份与实测回执保留在项目外层排障资料及被忽略的本地状态目录。

重启预览时，在确认 17882 未被占用且 Node >=22.19 的 PowerShell 中，从项目根目录执行：

```powershell
$env:O6N_RUNTIME_MODE = 'live'
$env:O6N_DEV_API_TARGET = 'http://O6N_HOST:17790'
$env:O6N_DEV_STATUS_TARGET = 'http://O6N_HOST:17780'
npm run dev --workspace @orion/console -- --port 17882
```

检查命令仍使用 `npm run typecheck`、`npm test`、`npm run check:source`、`npm run build`、`npm run test:browser` 和 `npm run test:projects`。浏览器检查可设 `$env:ORION_BROWSER_CHANNEL = 'msedge'`。Python 标准测试在可使用隔离状态目录和回环网络的环境运行；本次 Windows 专用启动夹具保存在 `.runtime/ui-migration-20261030/test-python.py`。

## 回滚方式

完成迁移后的本地提交由标签 `ui-basilos-20261030` 定位。回滚前先确认工作区干净、保留后续工作并停止本地预览。随后可以用以下命令创建一条反向提交，保留迁移历史：

```powershell
git revert ui-basilos-20261030
npm ci
```

如后续改动与迁移重叠，应审查并解决冲突；不要强制覆盖后续文件。本次没有执行回滚，没有使用 reset --hard 或清理源码目录。基线字节备份可在本地 Git 损坏时用于逐文件恢复。
