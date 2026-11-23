# Basilos UI 双页接入与优化记录

日期：2026 年 10 月 28 日，Asia/Shanghai。阶段一检查点为 `phase1-reviewed-20261028`，本轮在 `codex/basilos-ui-pages` 分支完成本地改造，恢复检查点为 `phase2-basilos-ui-20261028`。

资源监控与智能对话已采用 Basilos UI 的本地规则和组件源码，统一中性明暗主题，修复开发代理、导航、资源状态提示和聊天授权反馈。设备监控可通过本地界面读取真实数据。聊天设备授权接口返回 403，真实发送仍受设备原有授权控制；前端明确提示并保留草稿。

## 接入方式与版本

[平台入口](https://ui-harness-fqfangqi.vercel.app/)的在线文档需要登录。本轮采用用户指定相邻源码仓库中官方 `docs/operations/onboarding.md` 与 `references/component-sources.md` 提供的本地 CLI 和源码同步方式，没有注册或修改云端项目。

| 项目 | 本轮结果 |
| --- | --- |
| CLI | 本地维护源码 `@harness/cli@0.2.2` |
| 规则模式 | `connection=local`、`rules=ready` |
| 核心规则锁 | `local-core-a9e447f2844c007f12ea` |
| 应用识别 | `react-vite`，React 19，目标 `apps-console` |
| 元数据 | 独立的 `basilos.config.json`、`basilos.lock.json` |
| 原规则文件 | `AGENTS.md`、原 `harness.config.json` 保留 |
| 发现入口 | `entry=none`，显式使用锁定上下文，没有安装全局 Skill |
| 组件消费 | 通过 `@orion/harness-ui` 在项目内消费同步的源码 |
| 新增依赖 | 无；`package.json` 和 `package-lock.json` 保持原样 |

新增的九个源码模块为 Card、Alert、NativeSelect、Table、Skeleton、Empty、Progress、Separator、Kbd。现有 Button、Badge、Dialog、Popover、Input 等 Orion/Radix 封装继续复用，已有 PromptInput、Conversation 和 Message 的宿主适配继续保留。没有为了使用消息布局而引入完整 Streamdown、公式和 Mermaid 渲染依赖链。

原始文件 SHA-256、采用后的 SHA-256、宿主位置和适配说明保存在 `docs/basilos-ui-components.json`，旧来源记录在 `docs/component-provenance.json` 中保留。源码取自本地维护工作树，不宣称它等同于平台已发布的 candidate.4。唯一的新增基础组件 API 适配是 Table 的 `containerProps`，用于给真正的横向滚动容器设置名称、焦点和宿主样式；其余新模块只规范了换行。

主题从官方 `components/src/styles/shadcn.css` 映射中性表面 token 到 `packages/ui/src/styles/basilos.css`，没有引入文档站的全局 reset、额外动画依赖或字体下载。保留 `orion-console-theme`、宿主状态色、字体及主题事件。聊天页原来独立的绿色调色板已移除，弹层与两页共享相同 token。

## 开发代理与导航

`apps/console/vite.config.ts` 的请求分流如下，保持原 Host 和 Origin，不绕过后端鉴权。

| 请求 | 开发目标 |
| --- | --- |
| `/api/resources` | `O6N_DEV_RESOURCES_TARGET`，未设置则使用状态目标 |
| `/api/status` | `O6N_DEV_STATUS_TARGET` |
| 其余 `/api/` | `O6N_DEV_API_TARGET` |

本轮状态目标指向设备 17780，聊天目标指向设备 17790。监控、状态和聊天健康接口经本地 17880 均返回 200；会话接口返回 403“此设备未获模型调用权限”。没有修改设备的授权名单或服务配置。

开发模式默认公开导航配置为 `chatBase=/chat.html`、`dashboardBase=/`，显式公开配置仍可覆盖。生产构建继续按原 17780/17790 规则生成地址。实际浏览器已确认资源页到聊天页、聊天页到资源页的链接都指向本地 17880。

新增 `tests/development.test.mjs` 使用两个临时本地 HTTP 服务和真实 Vite 代理，验证监控与聊天分流、查询参数、NDJSON 中文增量、会话响应头、来源头、本地导航和生产地址兼容。测试不调用真实模型。

## 资源监控优化清单

| 现状问题 | Basilos UI 对应方案与实施 | 预期收益 | 优先级 |
| --- | --- | --- | --- |
| 指标与分区采用手写容器，样式分散 | 使用 Card、CardHeader、CardTitle、CardDescription、CardAction 统一指标与设备分区 | 信息层级、边框与明暗主题一致 | P1 |
| 演示、等待、错误、暂停容易混淆；无样本仍提示保留内容 | Alert 区分连接与快照提示，Empty 表达暂停，Skeleton 表达首次读取；无样本失败明确说明未收到采样 | 用户知道当前数值是否可用、下一步如何恢复 | P1 |
| 页面刷新下拉与其他控件风格不同 | NativeSelect 保留原生选择与关联标签 | 主题一致，键盘和手机选择体验保留 | P2 |
| 利用率条与未知值的视觉状态不统一 | Progress 映射为 meter，保留 N/A 与零值区别，未知值隐藏指示条 | 不把缺失读数误画成有效利用率 | P1 |
| 模型表格为手写结构，滚动容器的可访问属性难统一 | Table 系列组件，并在宿主同步版本增加 containerProps | 表格结构统一，实际滚动区域可命名、聚焦和键盘滚动 | P2 |
| 趋势缺少可读的时间范围说明 | 保留现有 SVG 算法，增加采样数、图像名称和说明文字 | 趋势含义更明确，不新增重型图表依赖 | P2 |

以上均已实施。真实指标口径、采样节奏、暂停与隐藏行为、快照导出、缺值处理、主机内存与卡载内存区分保持兼容。

## 智能对话优化清单

| 现状问题 | Basilos UI 对应方案与实施 | 预期收益 | 优先级 |
| --- | --- | --- | --- |
| 聊天独立配色覆盖共享主题 | 采用相同 Basilos token 映射，保留聊天布局变量 | 页面和 portalled 浮层明暗主题一致 | P1 |
| 欢迎区和任务示例缺少统一组件边界 | Card 组合欢迎区，Button 承载两个现有任务示例 | 视觉结构一致，示例仍只填草稿且不覆盖已有输入 | P2 |
| 健康接口成功时可能显示已连接，但会话其实没有权限 | 单独表示验证中、已授权、拒绝、会话连接失败；Badge 表达状态，Alert 提供重新检查权限 | 区分网络连接与发送权限，不再一直显示“正在连接” | P1 |
| 取消、失败和拦截提示使用不同手写容器 | AlertTitle、AlertDescription 统一结果与提示容器，保留真实回执 | 用户更容易识别结果和恢复路径 | P1 |
| 输入区提示和快捷键样式分散 | 复用 PromptInput，提示使用 Alert，快捷键使用 Kbd，菜单分隔使用 Separator | 控件与反馈一致，保持 IME、草稿和流式交互 | P2 |
| 现有 AI 组件已经承载滚动、草稿和历史兼容 | 保留已有 Conversation、Message 和 PromptInput 适配，按官方选型顺序复用 | 减少不必要的依赖与行为回归 | P1 |

以上均已实施。未改变回答模型、决策模型、调用范围、默认选项、审核、项目权限或审批契约，也没有真实发送请求或加载模型。授权失败时仍可查看本机已有对话和编辑草稿；设备管理员授权后可点击“重新检查权限”。

## 验证结果与范围

| 检查 | 结果与范围 |
| --- | --- |
| 类型检查与构建 | 根目录原生命令验证 console 与现有 agent-server 图谱 |
| JavaScript | 49 项，包含新增 Vite HTTP 代理与导航回归 |
| Python 桥接 | 45 项原有测试 |
| 浏览器 | 87 项，包含原有 85 项，以及未授权重试保留草稿、首次监控失败恢复两项 |
| 项目空间 | 16 项原有本地临时 API 与浏览器回归 |
| 源码边界 | 维持空示例与凭据检查，受限服务代码无差异 |
| 实际开发页面 | 资源指标与导航可用；真实聊天因设备授权 403 限制，未做模型发送验收 |
| Linux 设备采集器 | Windows 缺少 `os.sysconf`，仍需 Linux 环境复验 |

最终逐项结果、退出码与范围见 `.harness/runs/phase2-20261028/quality-report.json`、`additional-checks.json` 和 `final-verification.json`。浏览器回归使用独立 Edge 上下文及模拟接口，不能作为模型效果证明；实际设备只进行了读取。明暗主题、1440×900、390×844、320 窄屏、600 高短屏、键盘、IME、无障碍与覆盖范围内的草稿/流式/审批交互均纳入检查。

首轮截图发现 CardHeader 与欢迎区样式叠加导致手机标题变窄，且短屏发送按钮不可见；已修复宿主布局并复测通过。原始失败保存在 `first-ui-check/report.json`，修复结果在 `layout-repair/report.json`，没有降低断言或改写视觉基线。

## 完整启动与检查命令

在 PowerShell 执行以下命令即可启动带真实只读设备数据的本地界面。服务已经运行时不需要重复启动；需要重启时先在原终端按 Ctrl+C。

```powershell
Set-Location -LiteralPath 'D:\FQ\AI-demo\Web-UI-Harness-skill\O6N-web-test'
. .\.harness\use-node.ps1
$env:O6N_RUNTIME_MODE = 'live'
$env:O6N_DEV_API_TARGET = 'http://O6N_HOST:17790'
$env:O6N_DEV_STATUS_TARGET = 'http://O6N_HOST:17780'
npm run dev
```

预期显示 `http://127.0.0.1:17880/`。资源监控访问 `http://127.0.0.1:17880/#resources`，智能对话访问 `http://127.0.0.1:17880/chat.html`。17780 和 17790 是接口目标，不是把本地前端部署到设备。

以下命令在另一个根目录终端执行，用于重新检查本地规则与项目；不会部署：

```powershell
Set-Location -LiteralPath 'D:\FQ\AI-demo\Web-UI-Harness-skill\O6N-web-test'
. .\.harness\use-node.ps1
node '..\frotend-ui-harness\packages\cli\bin\harness.mjs' doctor --offline --root . --config basilos.config.json --lock basilos.lock.json
npm run typecheck
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run check:source
npm run build
$env:ORION_BROWSER_CHANNEL = 'msedge'
npm run test:browser
npm run test:projects
```

`doctor` 验证规则缓存与配置完整性，不代替浏览器验收。若缓存被清理，应使用匹配的官方 CLI 执行 `sync --offline`，保持现有锁，不静默升级。依赖未增加，本轮无需再次安装；重新安装仍在根目录使用 `npm ci`，并先关闭开发服务以释放 Windows 原生依赖文件。

接入问题及建议另存于用户指定目录的 `2026-10-28-O6N双页接入BasilosUI的问题与优化建议.md`，包括适用版本、复现步骤、影响与建议。本轮不部署、不推送，也不修改模型、AI Gateway、Agent 后端或设备服务代码。
