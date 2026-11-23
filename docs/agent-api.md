# Pi Agent 接口

浏览器通过原聊天端口的同源 `/api/agent/*` 访问。先 `GET /api/session`，由现有设备白名单建立 HttpOnly / SameSite 会话；POST 继续检查 Origin。内部 17794、17795 不对局域网开放，服务凭据不会下发浏览器。

| 方法与路径（相对 `/api/agent`） | 行为 |
| --- | --- |
| `GET /health` | 服务连接、项目和模型选项；`nativeHooks=false`、`hookMode=policy_bridge` |
| `GET /files` | 授权项目过滤文件清单 |
| `POST /conversations` | 用 id 幂等建立当前设备会话 |
| `GET /conversations/{id}` | 当前设备的完成轮次、关联 run 与有限上下文 |
| `GET /runs` | 当前与最近恢复的任务列表，不附带完整事件 |
| `GET /runs/{id}` | 完整任务、事件与待审批操作 |
| `POST /runs` | 创建任务，返回 202 |
| `POST /runs/{id}/approve` | 批准或拒绝一个具体审批 |
| `POST /runs/{id}/cancel` | 取消任务；可能继续等待已提交的模型请求退出后释放设备门锁 |

创建示例：

```json
{"project":"demo","model":"auto","scope":"local","access":"read","prompt":"读取 README.md，说明项目用途。","conversationId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","turnId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","files":["README.md"]}
```

`project` 首版只接受 demo；`model` 只接受 auto、standard、cloud；`access` 默认 read，edit 开放写入与检查的审批申请。prompt 为 1～6000 字符。Node 请求体最大 64 KiB。scope为local／hybrid，缺省local；cloud＋local或缺省范围会被拒绝。Auto允许云端时由Laya判决9B／DeepSeek，任务内锁模；2B、27B保留普通聊天。详见[动态选模](agent-routing.md)。

任务结构见 `packages/contracts/src/agent.ts`：id、project、model、scope、access、selected、phase、created、events、可选 approval。事件按 seq 排序，含 at、type、data。type新增routing、decision、usage；原事件包括 created、state、prompt、model、hook、tool_start、tool_end、tool_error、approval、approval_resolved、write_authorized、answer、model_error、error。

output固定最终回答格式，可选`{"format":"json","schema":{"type":"object","properties":{"count":{"type":"integer"}},"required":["count"],"additionalProperties":false}}`；省略时从当前明确的JSON输出要求推断，否则text。新增protocol_attempt和format_repair事件；格式纠正最多一次且禁止工具。JSON等待完整校验，文本保持流式。规则和限制见[工具协议](agent-protocol.md)。

v2.2中protocol_attempt成功项附加canonical（原始v2信封）、constrained（9B约束生成）；上游HTTP失败项附加failure_stage=upstream、elapsed_ms。私有agent_transport_error保留请求ID与锁定模型，未增加自动网络重试。浏览器不接收内部约束句柄，不能通过参数或请求头登记合约。

phase 为 checking、running、awaiting_approval、completed、blocked、failed、cancelled。**completed 表示模型流程结束，检查是否成功仍以工具的 exit_code 与实际输出为准。**文件与结果在审核通过后才展示；普通回答没有语义输出审核。

审批请求必须原样提交 approval 的 id、digest，并给出布尔 allowed。审批只适用于该任务、工具和参数，90 秒有效，一次消费；写入时再次核对旧文件 SHA。拒绝或取消后不执行该操作。

前端消费任务的真实事件流，断线时查询任务快照恢复。Agent 从模型流中增量解析回答字符串并发送 answer_delta；工具对象仍在完整校验后才执行。普通聊天继续 NDJSON 流式。后端真实 Gateway request ID 保存在原私有 SQLite 的 agent_gateway 事件中，用于运维对照 AI Gateway 请求日志。

常见响应：401 设备会话缺失；403 跨站或项目无权限；400 无效模型、参数或审批；409 已有活动任务；429 任务容量或基准测试占用。`/health.ready` 表示 Agent 服务已连接，模型实际就绪情况在原 `/api/health` 查看；任务启动校验候选模型就绪与scope，模型调用每轮核对任务lease。

原生 AI Gateway Agent Hooks 页当前不能接收 Pi。这里的 hook 是本项目自己的审核桥接记录，不能当成原生 Hook API 成功回执。检查、审批和文件边界是服务端控制，模型输出本身没有执行权限。

带关联的任务，审批与取消必须携带原 conversationId、turnId；摘要同时绑定会话与轮次。旧独立任务 API 保持兼容。

普通 `/api/chat` 支持 conversation_id、turn_id。仅网关完成后可调用回环 `/conversations/{id}/complete`；浏览器代理不暴露该路径、不能伪造内部 attest 或 owner 头。旧浏览器历史不会批量上传。
