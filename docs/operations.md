# 启动与部署

> 2026-10-22 当前规则：17780为资源监控，17790为聊天；模型、选模与协议测试展示已退出。生产构建设置 `O6N_RUNTIME_MODE=live`，不再复制 `data.json` 或历史测试附件。新建干净发布目录，仅发布HTML和本轮编译JS/CSS，再原子切换两个入口；不要复制旧发布目录。历史测试、Excel和构建快照统一位于项目外层“模型测试归档”；下文旧版的数据注入和保留原测试路径的步骤仅作为历史记录，不再用于参赛部署。聊天storage key、模型选择、后台路由、审核、项目和审批保持。

## UI / UX 静态发布

前端单独发布使用 `O6N_RUNTIME_MODE=live npm run build:console`，再运行 `npm run package:release`。公开配置仅用于展示设备信息。清除本地代理、预览地址和数据注入环境变量。打包脚本将两个 HTML 和构建资源放到 `.runtime/release/dashboard` 与 `.runtime/release/chat`。

在已准备网关、审核与推理依赖的 O6N 上，按[仓库 README](../README.md#o6n-一键部署)运行 `bash deploy/o6n/deploy.sh`，可安装前端、聊天桥接、Agent 和资源服务。

手工更新聊天桥接时，从同一版本同步 `services/o6n-bridge/` 的 Python 文件，包括共享的 `gateway_protocol.py`。已有网关地址配置和请求协议继续兼容。

上传前记录源码提交、每个文件和发布包的 SHA-256。设备新建独立发布目录，验证白名单文件清单、文件哈希和空间；保留两个原静态目标于 previous.json。只原子替换已有看板 / 聊天入口链接，不重启服务。核对后端文件、私有授权配置和运行 PID 在操作前后保持，保留旧目录用于恢复。

保留正确的文件发布时间：打包与解包不得把 HTML 修改时间设为早于旧发布的时间。现有服务依赖 Last-Modified 进行条件缓存，必须验证携带旧 If-Modified-Since 时返回新版 200，携带当前时间时才返回 304，避免旧浏览器继续使用旧入口。

线上验收必须访问实际设备的两个端口，检查桌面 / 手机和明暗主题、资源采样、导航、会话和真实本地回答。尤其要在聊天服务原有严格 CSP 下实际打开手机抽屉与弹窗；仅开发服务器或宽松 CSP 下通过不足以证明兼容。对应前端适配见 [CSP 说明](csp-modal-compatibility.md)。真实模型、截图与设备部署回执保存在项目外层部署记录或被忽略的本地状态目录，不进入源码。

HTTP / 资源哈希校验失败时立即恢复两个旧链接；浏览器发现发布阻断问题也先回滚再修复。回滚前确认当前链接仍属于该批次，校验旧入口哈希，避免覆盖后来发布。恢复静态链接无需重启服务，也不修改 Cookie、模型、授权或项目数据。


## 统一 Agent 入口（2026-10-22）

此次需配套发布 React、Agent Node 产物和 `agent_extension.py`。确认空闲并备份私有状态后，只重启 `o6n-smart-chat`、`orion-agent` 两个 user 服务；模型、AI Gateway、主板和公开端口保持。默认 Agent 无项目可聊天，写入/检查仍逐项审批。详见 [统一入口与回滚](unified-agent.md)。看板功能验收追加到独立字段，不覆盖旧跑分。

## Auto决策服务

两款deploy/o6n/o6n-decision-qwen35服务模板需先按已验证的运行库、权重位置与CPU拓扑调整，再运行systemctl --user daemon-reload。模板无Install段，不同时启用自启动。2B仅监听127.0.0.1:17804，4B仅监听127.0.0.1:17805。私有settings的decision_models_enabled=true才允许管理固定unit，默认关闭。

```sh
systemctl --user status o6n-decision-qwen35-2b.service --no-pager
journalctl --user -u o6n-decision-qwen35-2b.service -n 40 --no-pager
curl --fail http://127.0.0.1:17804/health
# 确认没有活动任务后，可手动管理按需服务
systemctl --user start o6n-decision-qwen35-4b.service
systemctl --user stop o6n-decision-qwen35-4b.service
```

正常加载由任务准入后的适配器管理，界面单选本身不加载。27B不会因自动判决被卸载。编译模型上下文可能覆盖启动参数，文本预算与截断标记另行检查。发布应一起部署Python适配器、路由、桥接及Node、React，备份原代码、units、配置和入口；只重启聊天与Pi，保留模型、Guard、AI Gateway。回滚恢复同批模块与入口，不清除新增会话或测试。

## GLiNER 澄清实验操作

澄清实验是私有离线测量作业，不是生产 Auto 的新依赖，不增加常驻对外端口。实验脚本、中文题集、选择清单和输出应保存在源码外；公开仓库仅包含 React 视图与空示例数据。复测时应使用带哈希的冻结实验包，不在生产 `gliner25-multi-decide/app.py` 上改分类契约。

先确认聊天无活动任务，使用既有 GLiNER 独立虚拟环境，在新的目录执行冻结作业。亲和性必须在torch创建线程前设置；本机核号须按实际CPU拓扑核实。推荐用 `systemd-run --user --collect` 创建临时unit，限定内存并保存日志，结束后不留推理进程。生产 `gliner25-multi-decide.service` 不重启，17786不变。新页面与JSON采取静态发布，17780／17790保持，历史测试资产逐个校验SHA256。临时进程结束不等同页面回滚；页面回滚按该批次 `previous.json` 恢复入口链接。

## MiniCPM分类实验的启动边界

本轮三款MiniCPM测试使用临时CPU服务，回环17801，单模型加载、单并发；完成或异常退出都会停止子进程并释放既有benchmark占用标记。它不成为聊天或Auto的新依赖。模型文件可以保留用于后续测试，临时服务未启用自启动；不修改原17752／17747的user unit。

参考手动启动（模型和运行时已校验；先确认17801空闲）：

```sh
~/minicpm47/llama.cpp/build/bin/llama-server \
  -m ~/minicpm-routing-20261021/models/MiniCPM5-1B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 17801 --alias minicpm5-1b \
  -ngl 0 -t 8 -tb 8 -c 4096 -b 512 -ub 256 --parallel 1 \
  --cache-ram 0 --reasoning off --jinja --offline
```

正式测试还需按设备拓扑绑定8个A720核，开启隔离目录的slot管理，每请求擦除KV并设置 `chat_template_kwargs.enable_thinking=false`；上述手动启动命令本身不是完整复测或性能认证。结束前台服务可用Ctrl+C，不通过停止生产模型腾空间。

既有模型按需启动仍为 `systemctl --user start minicpm5-2b.service` 或 `systemctl --user start minicpm47.service`，日志用 `journalctl --user -u <unit> -n 60 --no-pager`。这些命令不等于已经加入受控聊天模型池。网页仍使用原17780／17790，结果静态发布无需重启任一模型。

## 独立 GLiNER CPU 实验服务

该服务不参与 Auto。O6N 已部署的私有目录为 `~/gliner25-multi-decide`，使用独立虚拟环境、离线权重、8 个 A720 核、FP32；user unit 限制 `MemoryMax=4G`、`TasksMax=128`，仅监听回环 17786。启动会增加约 1.9GiB 常驻内存；按需停止实验服务可以释放资源，不影响线上 Laya。

```sh
systemctl --user status gliner25-multi-decide.service --no-pager
systemctl --user start gliner25-multi-decide.service
journalctl --user -u gliner25-multi-decide.service -n 60 --no-pager
curl --fail http://127.0.0.1:17786/api/health
systemctl --user stop gliner25-multi-decide.service
# 如果以后不再需要开机启动
systemctl --user disable gliner25-multi-decide.service
```

首次启动前必须已有校验过的模型目录及 `model-manifest.json`。新环境可设 `GLINER_ROOT` 指向私有目录，使用其独立环境执行 `python services/decision-models/gliner_cpu.py`；设置 CPUAffinity 和离线环境变量，不复用或修改线上 Laya 环境。依赖版本、模型许可和请求格式见 [decision-models.md](decision-models.md)。不得将权重、私有测量或环境凭据纳入 MIT 源码。

临时公平对照 `laya-cpu-comparison.service` 使用回环 17787，测试后已经停止，未启用自启动。不要把该临时实例当作线上 Laya。当前线上 Laya 仍在 17785。

新增看板 `#decision-routing` 读取独立 `assets/decision-comparison.json`；静态发布复制全部旧资产再添加新 JSON。无需重启聊天、Pi、模型、AI Gateway或主板。该次 `frontend-closeout/<release>/previous.json` 保存两个旧入口，回滚仅恢复这两个链接，保留全部测试与会话数据。停止 GLiNER 与静态页面回滚互相独立。

Agent协议v2.2随原Python聊天桥接启动，无新增端口、服务或环境密钥。部署时必须一起带上`bridge.py`、`agent_extension.py`、`agent_protocol.py`、`agent_constraints.py`，`agent_routing.py`保留原版本。检查依赖后，在没有活动任务时重启原聊天和Pi user unit；模型、Laya、Guard与AI Gateway无需重启。回滚应恢复同批Python模块和原静态链接，不能只移除约束模块而保留导入它的扩展。

约束只在当前Agent lease匹配的9B请求生效。遇到generation_contract_missing应停止并核对Gateway是否保留完整消息与物理模型，不通过关闭该检查恢复服务。协议错误查agent_protocol／agent_constraint；上游错误查agent_transport_error与Gateway请求ID。不要将HTTP502当作JSON错误或重置日限额。详见[工具协议](agent-protocol.md)。

## 从零构建

需要 Node.js >=22.19（推荐 24 LTS）、npm、Python 3.11+。在仓库根目录执行：

```sh
npm ci
npm run dev
npm run typecheck
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run check:source
npm run build
npm run package:release
```

`/` 是看板，`/chat.html` 是聊天，`/chat.html#agent` 只预选 Agent 草稿，随后归一到统一 `#chat` 工作区。没有后端时只展示示例，不运行模型或工具。`O6N_DEV_API_TARGET`、`O6N_DEV_STATUS_TARGET` 用于开发代理；设备后端仍执行自身的会话与客户端 IP 检查。

生产前端目录为 `.runtime/release/dashboard`、`chat`；Agent 产物为 `dist-agent/server.mjs`。Agent 运行目录另需安装锁定的 `@earendil-works/pi-coding-agent@1.3.0`、`@earendil-works/pi-ai@1.3.0`、`typebox@1.3.27`。不要从 Windows 复制 node_modules 到 ARM64 设备。使用锁文件与目标架构的 `npm ci --omit=dev --ignore-scripts`。

## 浏览器回归

首次准备 Chromium 后执行。也可设置 `ORION_BROWSER_CHANNEL=msedge` 使用已安装的 Edge，测试不会读取用户浏览器配置或会话。

```sh
npx playwright install chromium
npm run test:browser
```

默认回归使用锁定 Playwright 与 axe，在私有 `.harness/runs/browser-regression/build` 内重新构建空示例并注入模拟 API；不会调用模型、执行工具、改生产数据或覆盖 dist。`O6N_BUILD_DIR` 是隔离构建输出目录，普通构建仍输出 dist。当前夹具回归62项，不能把夹具结果当作真实推理结果。复制反馈用测试剪贴板，不访问用户系统剪贴板。

对已部署设备做只读 UI 验证时，显式提供 `ORION_BROWSER_CHAT_URL` 与 `ORION_BROWSER_DASHBOARD_URL`，执行 `node scripts/browser-regression.mjs --live`。这28项检查真实页面、资源刷新、主题、导航、模型菜单边界与工作模式键盘交互；不会提交模型请求。报告中的 `mode` 必须是 `device`，以确认启动脚本没有丢失 `--live` 参数。`ORION_BROWSER_OUTPUT` 可更改私有报告与截图目录。真实模型与工具闭环需要另行验收。

## O6N 服务

以下命令在 O6N 的普通运行用户终端执行，模型与 AI Gateway 的安装先决条件沿用既有部署。

| 服务 | 端口 | 启动命令 |
| --- | --- | --- |
| React 看板与资源采集 | 17780 | `systemctl --user start model-benchmark-dashboard.service` |
| 聊天与内部 Agent 桥接 | 17790、17791；17794 回环 | `systemctl --user start o6n-smart-chat.service` |
| Pi Agent | 17795 回环 | `systemctl --user start orion-agent.service` |
| 本地 9B | 17777 | `systemctl --user start qwen35-9b-houmo.service` |
| 2B | 17752 | `systemctl --user start minicpm5-2b.service` |
| Laya | 17785 | `systemctl --user start laya-multilingual.service` |
| 安全审核引擎 | 17793 回环 | `systemctl --user start o6n-qwen3guard-engine.service` |
| 安全审核适配器 | 17792 回环 | `systemctl --user start o6n-qwen3guard.service` |

纯文字多轮对话和超过 256 字符的单轮输入先在本机审核完整上下文，再由 Gateway 的输入保护回调确认。回调只复用当前请求、完整消息指纹一致的审核结果，请求结束即清除。预审推理限时 120 秒，桥接层等待 125 秒。审核繁忙、超时和超出输入上限均停止本轮，并分别提示原因。

在本地 Q8 审核引擎上，纯文本回答流式生成时可分段预计算下一轮对话的公共 token 前缀。后台只在空闲时尝试，检查当前历史和已预计算的回答前缀是否匹配。实际审核始终使用原模板和当前完整上下文独立生成标签；历史切换或被裁剪时由引擎按实际匹配的 token 复用，未命中部分重新计算。审核回执中 `runtime_timings.cache_n` 和 `prompt_n` 分别为复用及本轮计算的 token 数。

安装新 user unit 后执行 `systemctl --user daemon-reload`。首次启动用 `enable --now orion-agent.service`；**更换代码后用 `restart orion-agent.service`，enable 不会重启已经运行的进程**。聊天桥接代码改动需要重启 `o6n-smart-chat.service`，之后刷新网页重建设备会话。发布前检查没有活动任务、模型切换或基准测试。

```sh
systemctl --user status orion-agent.service o6n-smart-chat.service
journalctl --user -u orion-agent.service -n 50 --no-pager
curl --fail http://127.0.0.1:17790/api/health
systemctl --user restart orion-agent.service
systemctl --user stop orion-agent.service
```

停止 Pi 不停止普通聊天、模型或看板。不要将本地模型、Proxy、管理接口与公共网页混为同一鉴权入口。Agent 的内部接口只允许回环与随机服务凭据，不向浏览器下发这个凭据。

## 路径与配置

示例 unit：`deploy/o6n/orion-agent.service`。默认部署布局：

```text
~/orion-agent/releases/<release>/agent/{server.mjs,package.json,package-lock.json,node_modules/}
~/orion-agent/current -> 当前 agent 目录
~/.local/opt/orion/node-v24.19.0-linux-arm64/bin/node
~/.local/state/orion-agent/{internal-token,projects/demo,runs,conversations,backups,scratch}
~/o6n-smart-chat/{bridge.py,controlled_bridge.py,agent_extension.py,input_policy.py,routing_policy.py}
~/.local/state/o6n-smart-chat/settings.json
```

`ORION_AGENT_STATE` 是必填的绝对路径。聊天启动时生成 `internal-token`；Node 读取同一私有文件。Gateway Key、Webhook Token、设备 IP 白名单使用私有 `settings.json`，字段见 `deploy/o6n/settings.example.json`。证书与供应商 Key 沿用原部署，不进入仓库。项目根目录与状态目录均由运行用户持有，不授予 Docker 管理权限。

Node 官方 ARM64 包需校验官方 SHASUMS；本次固定 v24.19.0。Bubblewrap、prlimit、Python3 是执行检查的必需依赖，缺少时拒绝执行。没有用户命名空间支持的平台可运行只读功能，但不能声称隔离检查已可用。

## 恢复与保留数据

前端通过两个现有软链接切换；回滚指向上一目录。静态前端单独发布可存放在 `~/o6n-console/frontend-closeout/<release>/{dashboard,chat}`，其 `previous.json` 保存两个旧目标；Agent运行时仍位于 `~/orion-agent/current`。仅切换静态文件不需要重启服务。后端改动先复制到部署备份目录，恢复后重启聊天。Pi 的文件写入备份位于私有 `backups/<run>`，包含文件路径、旧内容、旧 SHA 与新 SHA；恢复前核对项目当前文件仍是该新 SHA，避免覆盖后续修改。恢复旧文件或删除新建文件均需人工确认，不通过模型自动执行。

测试 payload、Excel、原浏览器会话和 SQLite 保持原位置。不得用空 examples 发布包覆盖生产 data.json。JSONL 与备份为私有审计数据，应由部署者制定保留与清理期限；首版只恢复最近 200 个任务，不自动清除旧文件。

执行检查必须确认当前 cgroup 的 `pids.max` 为有限值且不超过 128；user unit 设置 `TasksMax=128`、`MemoryMax=1G`。不使用针对整个运行用户的低 `RLIMIT_NPROC`，避免把既有模型进程计入而导致 namespace 创建失败。

## 从源码运行看板参考后端（Linux）

`services/dashboard/` 现包含资源采集与参考 HTTP 服务。已有生产服务保持运行，不重复绑定相同端口。新环境在仓库根目录构建后，可将 `services/dashboard/current` 链接到 `.runtime/release/dashboard`，设置 `O6N_PUBLIC_HOST` 为设备公开主机名，再运行：

```sh
python3 services/dashboard/server.py --port 17780
python3 -m unittest discover -s services/dashboard -p 'test_*.py'
```

后摩采样依赖部署者已有的官方 `hm_smi`。未安装时指标显示缺失，不自动安装或重置加速卡。生产部署本次未替换或重启原采集服务。

统一工作区仍用上述服务与端口，无新增公共端口。更新 Node 与 Python 后依次重启聊天桥接、Pi，刷新网页重建设备会话。回滚须同时恢复前端、两个 Python 文件及 Agent 链接；保留私有 conversations 与 runs，不删除新版浏览器索引。详见 [统一工作区](unified-workspace.md)。

## 历史：Sender组件依赖与发布（已由Harness源码替换）

聊天输入库锁定`@ant-design/x@2.7.0`与`antd@6.1.1`，已经写入工作区package和根package-lock。干净检出使用`npm ci`，开发`npm run dev`，完整编译`npm run build`，不需要另启动组件库服务或修改后端。不要使用开发者机器的绝对路径依赖。

本次仅静态前端发布，端口17780/17790及现有systemd启动命令保持；不重启Pi、Python桥、模型或主板。若回滚，使用该次静态发布的`previous.json`恢复两个入口符号链接，禁止清除模型或测试数据。许可证与第三方依赖文本由`node scripts/dependency-notices.mjs`更新。

Sender迁移后完整夹具为37项；新增3项输入组件回归，原34项继续执行。依赖本地安装和生产静态部署不会启动额外服务。

## Pi流式与Harness直接组件版本

此节取代前述Sender当前配置：执行`npm ci`后工作区会链接`@orion/harness-ui`，无需启动外部组件库、Workbench或安装模型SDK；此前Ant Design X/antd/cssinjs直接依赖已移除。原npm开发、构建与systemd命令保持。生产Node默认仍17795回环；ORION_AGENT_PORT只可显式改回环监听端口，测试使用0选择空闲端口。

本次同时更新前端、Pi Node产物和Python agent_extension，需要在设备空闲时备份并重启聊天桥及Pi服务，不重启模型、看板、AI Gateway或主板。原会话、任务归档、审批状态和测量数据不迁移/删除；回滚恢复该次previous.json记录的前端及Node链接，并恢复两个Python文件备份。停止/中断仍等待在途模型排空。

排查流式时确认同源events响应为application/x-ndjson、快照/entry持续到达、代理逐行flush及心跳；不要把工具JSON直接展示或执行，不以浏览器逐字动画替代模型流。详细诊断从用户主动打开的执行详情查看。

## 后续聊天体验优化：仅静态前端

菜单、等待反馈、统一回答操作、详情与审批阅读、历史分组的变更只涉及 React 和前端辅助代码。仍执行 `npm ci`、`npm run dev`、`npm run build`，不需要新服务、端口、组件库服务或环境变量。设备上仅更新两个静态入口；Pi、桥接、模型、AI Gateway 和现有测试数据继续使用原版本及启动命令。

静态发布时保留当前生产 data.json 与附件散列，记录两个旧入口到该次 previous.json，原子切换链接并验证两端资源。失败时恢复这两个入口即可；不回滚 Pi 流式后端、不删除会话或归档、不以空示例覆盖实测数据。

侧栏和输入框交互调整同样只发布静态前端。`npm run test:browser` 增加侧栏折叠与快捷键、正文搜索、会话完整草稿恢复、异步提交时切换会话、320px 窄屏工具栏和手机搜索检查。继续使用既有开发命令、端口与服务；更新后刷新浏览器载入新的带散列资源，旧会话存储保持兼容。Linux 资源采集器的额外单测依赖 `os.sysconf` 和 `/proc`，须在 Linux 执行；根目录的 Python 桥接单测可在 Windows 执行。


## Agent动态路由部署

当前Python桥接需要同时部署 `agent_extension.py` 和 `agent_routing.py`。Node产物为 `dist-agent/server.mjs`，依赖与端口保持；不需要sudo、不重建AI Gateway、不更换模型权重或驱动。先备份当前Python文件、Node链接、两前端链接及私有状态；确认无任务和模型切换后，更新代码并依次重启聊天桥接与Pi：

```sh
systemctl --user restart o6n-smart-chat.service
systemctl --user restart orion-agent.service
systemctl --user status o6n-smart-chat.service orion-agent.service
journalctl --user -u orion-agent.service -n 60 --no-pager
```

恢复服务后刷新网页建立设备会话。Laya仍由既有 `laya-multilingual.service` 提供，不为每轮任务重载。范围缺省local；9B未加载时仅本地停止，使用现有普通聊天切换入口由操作者加载9B，不通过Agent自动切卡。判决故障夹具不得通过停止共享Laya或修改生产额度来模拟。

路由实测数据独立注入 `assets/agent-routing.json`，看板入口 `#agent-routing`；原data.json、Excel和历史附件不变。新增原始路由和任务对比另存私有目录，不打入开源示例。静态结果更新可原子替换该JSON，无须重启模型或服务。

回滚应恢复这次备份的Node与前端链接、Python文件，若备份前不存在agent_routing.py则只移走此次新增模块，再重启聊天和Pi。保留新旧会话、runs、审批日志和测试结果。旧客户端不含scope时按local处理，不继承历史云端授权；费用以AI Gateway真实用量回执为准。

## Agent协议v2

Python新增`agent_protocol.py`，必须与`agent_extension.py`同时部署；`agent_routing.py`继续使用原版本。更新Node产物和前端后，仍只在空闲时依次重启聊天桥接、Pi，沿用上方systemd命令。无需重启AI Gateway、模型、看板、主板或加速卡，不增加公开端口。

旧备份可能没有agent_protocol.py，回滚时恢复Python与Node、前端链接，并移走此次新增模块。保留任务归档、会话和审批数据。协议实测另存assets/agent-protocol.json，空示例不能覆盖生产数据。标准文本仍流式，JSON等待校验；纠正最多一次，其云端调用计入原额度，不自动修改额度或费率。


## 项目空间升级

项目空间不新增公开端口或服务，仍使用17780/17790。需同时更新React、Node产物、controlled_bridge.py、agent_extension.py和agent_protocol.py，空闲时备份ORION_AGENT_STATE后重启聊天与Pi。启动命令、设备标识迁移、导入恢复与完整回滚注意事项见[项目空间](projects.md)。新增`npm run test:projects`运行真实Node项目接口与React浏览器验收，不调用模型。
## 后摩分类实验的运行边界

后摩小模型分类实验与生产回答模型共享单卡，应串行执行。准备阶段下载并校验权重，不替换公共运行库；正式阶段使用既有benchmark锁、临时回环端口，停止当前占卡模型后加载实验模型。正常退出、Ctrl+C或systemd停止均应清理临时服务、恢复原模型并核对健康，再释放锁。

具体题集、权重、benchmark脚本、命令与恢复记录由部署者放在私有实验目录，不随MIT源码发布。禁止在实验占卡时绕过benchmark锁继续聊天；若进程被强制杀死，应先确认临时进程和端口均已释放，再按原user unit恢复模型，不能默认需要复位加速卡或重启主板。

看板新增结果应保留旧记录与附件，以独立归档及入口切换实现回滚。主机RSS与卡内存分开显示，资源支持、实际推理及分类准确率分别记录。实验模型不自动进入生产Auto。


## 新回答模型池

后摩4B／2B回答复用决策服务17805／17804，互斥准备以保留显存；9B继续17777。MiniCPM-V使用既有CPU服务17747，原CPU MiniCPM5保留17752。仅选择模型不启动，发送后才准备；不要同时手工启动多个占卡模型。普通聊天手动27B会释放小模型。

```sh
systemctl --user status o6n-smart-chat orion-agent --no-pager
systemctl --user status o6n-decision-qwen35-4b o6n-decision-qwen35-2b minicpm47 --no-pager
journalctl --user -u o6n-smart-chat -n 60 --no-pager
journalctl --user -u minicpm47 -n 40 --no-pager
curl --fail http://127.0.0.1:17790/api/health
```

图片审核需要9B就绪和文本Guard正常；按精确输入摘要复用短期本地视觉检查，AI Gateway Block为最终准入。缺失／不确定／故障时停止。更新Gateway模型目录与逻辑路由需校验后发布；保存草稿不代表已激活。回滚需配套恢复前端、桥接代码和Gateway路由，保留期间新增会话与事件。
