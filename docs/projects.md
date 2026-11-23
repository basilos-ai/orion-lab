# 项目空间

项目是 O6N 上的独立文件目录、项目说明与会话分组。用户从侧栏“项目空间 +”、聊天空白页或顶部“项目”进入创建和管理；聊天与 Agent 仍使用同一工作区。

## 首版操作

1. 创建空项目，或选择电脑文件夹。名称支持中文；目录使用服务端校验的独立随机 ID，不使用名称拼接路径。
2. 新项目进入 Ask、Auto、仅本地。创建、上传、管理和导出不调用模型。
3. 文件夹导入先预览，再确认；只处理 UTF-8 文本，显示每项跳过原因，不覆盖已有路径。电脑原目录保持原状，操作对象是 O6N 副本。
4. 项目文件可新建目录、新建或编辑文本、搜索路径、预览、下载和导出 ZIP。人工保存是用户明确提交的文件操作，带原文件 SHA 校验；Agent 写入、创建目录、执行检查仍逐次审批。
5. 归档保留目录和会话，可查看、导出、恢复；不提供永久删除。任务执行中的项目不能导入、写入、修改信息或归档。

限额：每个项目 200 个文件、400 个文件及目录条目、1 MiB 文件内容，单文件 32 KiB，目录深度 5，每次本地选择最多 1000 项。工具附加上下文仍最多 5 个文件，读取及模型上下文另有原来的预算，容量不等于整项目自动发送给模型。空目录不会随浏览器文件夹上传导入，可在项目内新建。首版不支持二进制、任意 O6N 路径挂载、Git 克隆、Windows 原目录直接写回。

隐藏路径、node_modules、凭据目录及敏感内容拒绝；服务端不接受符号链接、硬链接和路径穿越。原 `demo` 项目不迁移、不覆盖，其文件仍可使用；为保留未知历史文件，批量导入需使用新建托管项目。目录超过展示范围时明确提示，不假装已返回完整文件树。

## 架构与契约

- `packages/contracts/src/projects.ts`：ProjectSummary、ProjectFiles、ImportPreview、共享容量限制。
- `apps/agent-server/src/projects.ts`：私有注册表、根目录解析、归属检查、文件管理、导入事务、归档恢复和导出。
- `apps/console/src/features/projects`：复用既有 Harness/Radix UI 的创建、管理、导入预览和文件编辑；ZIP 在浏览器内生成，不增加运行依赖。
- `packages/tool-runner`：原相对路径边界，新增单层 `create_directory`；Agent 配置项目容量守卫，模型不能通过工具绕过容量限制。
- `packages/agent-runtime` 与 Python 工具协议同时登记 `create_directory`。只在 edit 模式提供，审批摘要绑定项目、会话、轮次、任务和参数；原写文件审批继续绑定旧 SHA。
- Python 网关沿用可信设备、同源校验、短期调用会话和内部令牌，扩展项目代理路由。不改 AI Gateway，不冒用原生 Pi 来源。

全部接口位于 `/api/agent` 下：

| 方法与路由 | 用途 |
| --- | --- |
| GET /projects | 当前设备项目，含已归档状态 |
| POST /projects | 创建；客户端随机 ID 支持同次创建重试 |
| GET /projects/:id | 项目摘要，不含 owner 或绝对路径 |
| GET /projects/:id/files | 当前项目文件树、限额与截断标记 |
| POST /projects/:id/read | 按相对路径读取文本与 SHA |
| POST /projects/:id/write | 人工保存，要求 beforeHash，创建时为 null |
| POST /projects/:id/mkdir | 人工创建一个空目录，父目录须存在 |
| POST /projects/:id/preview | 校验文件内容，生成十分钟有效的预览 |
| POST /projects/:id/import | 确认当前设备、项目及预览 ID，校验目录快照 |
| POST /projects/:id/update | 修改名称、说明或 archive/restore，绑定 revision |
| GET /projects/:id/export | 导出安全文件清单，前端下载 ZIP |
| GET /conversations | 归属设备的会话索引 |
| POST /conversations | 建立会话、首次绑定项目或同步标题 |

普通聊天可首次关联项目并继续原上下文；移除本轮项目上下文后可回到普通聊天。`boundProject` 保留会话所属分组，后端绑定不取消。切换到不同项目需新会话，运行中的任务根目录、模型租约和审批不随界面变化。

## 身份与存储

首版是个人设备空间，并非多人登录系统。持久的 HttpOnly、SameSite=Strict 签名设备标识取代项目归属对 IP 的依赖；原可信 IP 白名单和短期调用会话仍有效。新标识由服务器签发，浏览器不能自行设置 owner。HTTPS 部署应在入口补齐 Secure 传输策略；现有局域网 HTTP 端口保持。

读取旧会话时，网关只提供当前已授权 IP 的旧归属别名；服务端兼容读取，但不迁走旧记录归属，防止首个新浏览器占用其他浏览器的旧会话。旧系统中同一 IP 的共享语义无法自动还原为独立账户。新建项目与会话使用持久标识，不经旧别名重新分配。不要清除设备标识来排障，否则新项目不会自动归属新浏览器；换浏览器、跨设备共享、账户恢复和多人 ACL 需后续独立方案，不宣称已有账户级隔离。

私有状态均在 `ORION_AGENT_STATE`：

```text
projects/<id>/              项目文件，保留原 projects/demo
project-registry/<id>.json  名称、归属、说明、状态与 revision
project-audit/<id>.jsonl    人工文件操作摘要，不记录文件正文
project-imports/<uuid>/     导入事务及导入前目录备份
project-scratch/<id>/       隔离检查临时副本
conversations/              原完成会话与稳定项目绑定
runs/                       原 Agent 任务归档
```

注册表原子写入。导入预览仅保存在进程内，重启后需重新预览；确认时校验文件快照，构建暂存副本后切换目录，失败保留原目录。切换期间进程退出导致项目根目录缺失时，启动恢复事务的 before 目录；不自动继续执行任务。导入备份保留于私有目录，首版无自动清理任务。

## 启动、升级与回滚

开发和构建仍使用根目录 `npm ci`、`npm run dev`、`npm run typecheck`、`npm test`、`npm run build`。默认构建是无模型演示；需要 API 联调时设置 `O6N_DATA_DIR` 和原 `O6N_DEV_API_TARGET`。项目功能不需要额外数据库、容器或公开端口。

设备端沿用原服务，更新 Node 产物、Python 的 `controlled_bridge.py`、`agent_extension.py`、`agent_protocol.py` 及 React 多入口。先确认任务空闲并备份私有状态，再更新；不重启模型、Laya、AI Gateway或主板。

```sh
systemctl --user restart o6n-smart-chat.service
systemctl --user restart orion-agent.service
systemctl --user status o6n-smart-chat.service orion-agent.service --no-pager
journalctl --user -u orion-agent.service -u o6n-smart-chat.service -n 60 --no-pager
```

更新后刷新网页建立调用会话，持久设备标识会继续使用。17780 看板及 17790 聊天保持；17794、17795 仍仅回环。不要把内部令牌、会话标识或真实项目打入前端、文档或 MIT 源码包。

回滚先恢复发布清单记录的两前端和 Node 链接、三个 Python 文件，再重启上述服务。旧版本按 IP 识别会话，因此完整回滚还需在私有备份中保存升级后状态，将升级后新增会话的私有 legacyOwner 映射用于旧版兼容归属；不能用升级前快照直接覆盖并丢弃升级后会话和项目。新注册表、目录、任务和导入备份应保留，旧版本只是不提供其管理入口。

验收命令：`npm run typecheck`、`npm test`、`python -m unittest discover -s tests -p 'test_*.py'`、`npm run check:source`、`npm run build`、`npm run test:browser`、`npm run test:projects`。实机使用 `ORION_PROJECT_URL` 指定聊天入口，再运行 `node scripts/project-browser.mjs --live`；该脚本只操作专用验收项目，结束后将其归档，不调用模型。
