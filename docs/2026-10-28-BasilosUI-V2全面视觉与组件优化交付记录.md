# Basilos UI 管理后台模板 V2：全面视觉与组件优化

日期：2026-10-28。范围：资源监控、智能对话及二者共用的前端框架。未部署、未推送，未修改模型、AI Gateway、设备服务代码。

## 结果

项目原本已是 React 19.2.8 + Vite；保留 React，全面采用线上发行版 0.4.0-agent-materials.1 中的 Basilos UI 基础组件，以及模板使用的 Radix UI / Tailwind CSS / Recharts。组件通过官方 CLI 获取并独立校验完整 SHA-256。来源并非旁边的维护仓库，也并非由截图猜测。

统一 V2 系统字体、256px 侧栏、14px 卡片圆角、中性色、标题层级、按钮、选择器、表格和弹窗间距。提供亮色 / 暗色 / 系统主题、中性 / 品牌橙 / 蓝色、舒适 / 紧凑密度，并在浏览器保存。强调色不改变成功、警告和错误状态的含义。

## 页面变化与验收

| 页面 / 区域 | 具体适配位置 | 变化与收益 | 验收 |
| --- | --- | --- | --- |
| 共用框架 | apps/console/src/components/app-shell.tsx、appearance-settings.tsx、styles/template-v2-theme.css | 使用 Basilos Sidebar、Sheet、Card、RadioGroup；统一字体、导航和外观设置 | 桌面收起、移动抽屉、键盘与焦点返回、偏好刷新恢复通过 |
| 资源监控 | features/resources/resources-page.tsx、resource-charts.tsx | 使用真实 Card、Select 和 Recharts / ChartContainer；四指标卡、CPU 与可用内存历史图、数据区域间距统一 | 0 / N/A / 首次加载 / 请求失败区分；无有效历史时不绘图；断点不连线；暂停快照标识；严格 CSP 通过 |
| 智能对话 | features/chat/*、components/ai/*、components/ui/button.tsx | 迁移按钮、输入、Popover、弹窗，统一消息、欢迎区、输入框和工具栏；保留现有受控 PromptInput | 草稿、输入法、范围选择、流式回答、停止与恢复、设备权限提示、移动端 320/390px 通过 |

先前代理和导航保持不变。资源接口继续从状态服务读取，聊天继续沿用原接口。没有为外观生成业务假历史；回归图表中的合成观测只在隔离夹具中存在。

## 测试与边界

- 根目录类型检查通过；JavaScript 单测 50/50，Python 单测 45/45；源码边界检查及完整构建通过。
- 最终完整浏览器回归 93/93，包含明暗主题、移动端、axe、CSP 和新增外观 / 历史图表检查。证据：.harness/runs/basilos-v2-full-20261028/browser-final/report.json。
- 项目空间浏览器检查 16/16，使用本地真实 Node API；模型请求计数受测试约束。证据：.harness/runs/project-spaces/browser/report.json。
- 本地实时资源页面已人工核对，能显示设备实际采样。智能对话页面如实显示当前设备未授权；没有绕过权限或进行真实模型推理。
- 完整 npm audit 仍报告既存模型后端依赖 @earendil-works/pi-coding-agent / undici 的 1 项 moderate、1 项 high；新增前端 nanoid 已采用同主版本补丁 3.3.20。未执行 audit fix --force 或修改模型依赖。
- Recharts / 模板基础组件在当前宿主内已验证；未验证全部模板演示路由、Tiptap、演示服务及所有第三方组件分支，未将这些能力冒充为已接入。

## 来源与恢复

- 完整来源路径、版本、完整文件 SHA-256 与独立校验结果：项目开发归档中的相应快照（共 27 份）。
- 本轮适配后源码快照：项目开发归档中的相应快照（39 个目标文件，含内容和 SHA）；保留前一轮快照供比较。
- 组件归属与宿主改动：component-provenance.json。保留 basilos.config.json、basilos.lock.json 和原规则版本。
- 新增固定依赖：recharts@3.10.1（前端与组件工作区）；nanoid@3.3.20（组件工作区）；package-lock.json 与 THIRD_PARTY_NOTICES.md 已同步。

## 本地查看与完整命令

当前开发服务仅监听本机：http://127.0.0.1:17880/#resources 与 http://127.0.0.1:17880/chat.html。可在“外观与使用说明”调整主题色和密度。

以下 PowerShell 命令从根目录选择项目 Node 24，再启动原代理分流的前端。预期输出 Vite 地址 127.0.0.1:17880；若当前服务已运行，直接打开地址即可。

```powershell
Set-Location -LiteralPath 'D:\FQ\AI-demo\Web-UI-Harness-skill\O6N-web-test'
. .\.harness\use-node.ps1
$env:O6N_RUNTIME_MODE = 'live'
$env:O6N_DEV_API_TARGET = 'http://O6N_HOST:17790'
$env:O6N_DEV_STATUS_TARGET = 'http://O6N_HOST:17780'
npm run dev --workspace @orion/console
```

复核命令（均在上述根目录运行）：

```powershell
npm run typecheck
npm test
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p 'test_*.py'
npm run check:source
npm run build
$env:ORION_BROWSER_CHANNEL = 'msedge'
npm run test:browser
npm run test:projects
```

build 只生成本地产物，不发布。浏览器完整回归使用独立夹具，项目空间检查使用隔离的本地 Node 测试服务。
