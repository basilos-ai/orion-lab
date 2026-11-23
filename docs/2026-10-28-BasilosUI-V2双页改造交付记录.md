# Basilos UI V2 双页改造交付记录

日期：2026-10-28。项目：D:\FQ\AI-demo\Web-UI-Harness-skill\O6N-web-test。
用户已确认上一轮源码核验与实施方案，本轮完成其P0/P1项。资源发行版保持0.4.0-agent-materials.1，原规则local-core-a9e447f2844c007f12ea与entry=none保持不变。

## 已完成

| 页面/位置 | 改动 | 来源与约束 |
| --- | --- | --- |
| apps/console/src/features/resources/resources-page.tsx | 使用已接入的Card(sm)、CardHeader、CardContent组合指标卡，主数值与微趋势并排，保留单位、说明和真实状态 | 参考V2 metric-card.tsx；使用现有SVG，未新增Recharts依赖或演示比较数据 |
| apps/console/src/styles/resources.css | 指标卡采用中性浅灰、24px数字、72×36微趋势、紧凑间距；按内容容器1/2/4列响应；页头操作底部对齐、换行和触屏高度 | 参考V2概览命名容器查询和AdminPageHeader；保留O6N四项指标 |
| apps/console/src/features/resources/resource-state.ts | 只有至少两个连续、时间有效且顺序正确的真实采样才显示趋势；空历史、单点、缺失、重复时间、断档单独处理 | 数值0仍是有效数值；缺失不补0，不生成历史 |
| apps/console/src/features/resources/use-resources.ts | 增加fetching状态与请求中保护；刷新按钮忙碌，刷新时保留内容；暂停或页面隐藏继续停止请求 | 延续原/api/resources契约和轮询周期，不修改采集器 |
| apps/console/src/styles/basilos-v2.css | 集中对话输入区、工具栏、消息、操作按钮与跳到最新样式；使用内容容器适配窄屏 | 参考V2消息/输入器组合，保留现有PromptInput与use-stick-to-bottom |
| apps/console/src/styles/chat-workspace.css | 移出重复的旧Harness输入器样式，将相关规则集中到basilos-v2.css | 减少同类样式散布；不更换会话布局与存储 |
| apps/console/src/features/chat/chat-composer.tsx | 权限提示与输入框aria-describedby正确关联；保留重新检查、可编辑草稿、发送禁用和停止行为 | 不迁入Mock模型、模拟回复、固定用量或演示来源 |
| apps/console/src/components/ai/prompt-input.tsx | 组合输入保护明确限制为Enter键；保留Shift Enter、候选词编辑与clearOnSubmit=false | 受控草稿仍由宿主管理，原/api/chat与/api/agent保持 |
| tests/resources.test.mjs、scripts/browser-regression.mjs | 验证0/缺失、真实连续采样、空历史、保留内容刷新、无并发轮询、侧栏展开/收起引起的内容宽度变化 | 使用本地fixture，无真实模型调用 |

本轮没有修改Vite代理、导航、useChat、模型、AI Gateway、设备服务、package.json/锁文件或Basilos规则锁。未部署、推送或安装MCP，没有新增依赖。Recharts、Tiptap、完整模板和执行详情分栏P2项仍为后续可选项。

## 已执行验证

所有命令均从项目根目录执行，使用仓库已有.harness/use-node.ps1选择Node24.19.0。

| 检查 | 最终结果 |
| --- | --- |
| npm run typecheck | console与agent-server均通过 |
| npm test | 50/50通过 |
| python -m unittest discover -s tests -p 'test_*.py' | 45/45通过，禁写pyc |
| npm run check:source | 通过；保留原凭据/私有内容检查规则 |
| npm run build | console与agent本地构建通过；未部署 |
| npm run test:browser | 89/89通过，Edge fixture，包含主题、窄屏、axe、IME、草稿、权限、流式与新增资源用例 |
| 最终输入法保护复核 | 13/13相关浏览器用例通过，包含组合输入、草稿、拒绝发送与会话权限 |
| npm run test:projects | 16/16通过 |
| Git空白检查 | Windows CRLF口径通过；仅使用命令级core.whitespace=cr-at-eol，未更改Git配置 |

首次npm test有两个本地HTTP fixture服务在并发启动时超过10秒；单独串行重跑2/2通过，随后未改服务或测试超时设置，完整npm test重跑50/50通过。因此记录为一次性启动波动，不掩盖首次失败。

前轮分析报告包含本机用户缓存绝对路径，触发源码边界门禁。已将仓库内两份报告改为可移植用户目录表示，原始版本保留于忽略的本地验证目录；未放宽门禁。资料身份与源码SHA-256不变。

截图已人工检查：资源页展开侧栏、桌面对话、窄屏暗色长回答。截图中的数据来自fixture，不能作为真实设备性能或模型效果证明。Linux专用资源采集测试不包含在上述tests目录的45项中；本轮未修改该服务。

## 证据与恢复

- 线上资源证据：项目开发归档中的相应快照。
- 精确适配基线：项目开发归档中的相应快照，保存9个前端目标的完整适配后内容、SHA-256和固定发行版来源，便于以后进行三方比较。
- 来源登记：docs/component-provenance.json中的basilos_v2_adaptation。
- 全量浏览器报告与截图：.harness/runs/basilos-v2-20261028/browser/。
- 最终IME/草稿复核：.harness/runs/basilos-v2-20261028/ime-final/。
- 项目浏览器报告：.harness/runs/project-spaces/browser/。
- 原始本机路径分析版本：.harness/runs/basilos-v2-20261028/analysis-original/，不进入源码发布。

在实际设备上的只读联调只验证页面/API可达与权限状态；未发送真实问题、切换模型或执行工具任务。数据新鲜度及设备会话权限仍由真实接口控制；浏览器已有Cookie可能与无Cookie的命令行探测不同。未以fixture成功冒充真实设备回答验收。

## 本地查看与完整命令

当前开发服务只监听127.0.0.1:17880：
- 资源监控：http://127.0.0.1:17880/?#resources
- 智能对话：http://127.0.0.1:17880/chat.html

服务已在本机启动。以下命令用于将来服务停止后的手动恢复，作用是沿用原来的本地代理分流，不部署：

~~~powershell
Set-Location -LiteralPath 'D:\FQ\AI-demo\Web-UI-Harness-skill\O6N-web-test'
. .\.harness\use-node.ps1
$env:O6N_RUNTIME_MODE = 'live'
$env:O6N_DEV_API_TARGET = 'http://O6N_HOST:17790'
$env:O6N_DEV_STATUS_TARGET = 'http://O6N_HOST:17780'
npm run dev
~~~

预期终端显示Local: http://127.0.0.1:17880/。端口已占用时应使用当前服务，不重复启动；退出可按Ctrl+C。

后续重复检查也在根目录执行：

~~~powershell
Set-Location -LiteralPath 'D:\FQ\AI-demo\Web-UI-Harness-skill\O6N-web-test'
. .\.harness\use-node.ps1
npm run typecheck
npm test
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p 'test_*.py'
npm run check:source
npm run build
$env:ORION_BROWSER_CHANNEL = 'msedge'
$env:ORION_BROWSER_OUTPUT = '.harness/runs/basilos-v2-20261028/browser'
npm run test:browser
npm run test:projects
~~~

这些命令分别检查类型、行为、Python契约、源码边界、构建和浏览器流程；不会自动部署或推送。业务代码改动与来源基线均保留在本地工作区，未创建提交。
