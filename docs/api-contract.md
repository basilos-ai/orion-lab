# 后端接口契约

## 快速体验与执行反馈

- POST `/api/agent/experiences/output`：仅接受空对象 `{}`；沿用设备会话、同源、内部令牌和设备主体校验。使用实际项目 `AnswerStream` 对固定合成材料自检，不接受调用者候选文本或配置，不调用模型、不访问文件。回执含 `kind=synthetic_output_self_test`、`scope=project_output`、`checker`、`safe_passed`、`blocked`、`sensitive_visible`、`passed`、`model_called=false`、`semantic_review=false`、`tested_at`。
- 自动选模与输入体验使用原 POST `/api/chat`，只带独立固定材料、`scope=local`，不提交当前会话/项目/文件。输入体验使用手动 `small`，选模体验使用 `auto`。正式页面只消费服务端事件，无前端伪造拦截或模型归属。
- 普通聊天完成结果保留 `actual_upstream_model`、真实 `stages`、`decision`、`fallback` 和 `output_policy`；服务端完成轮次新增可选、有界的 `feedback`，恢复历史继续显示，不参与模型上下文。旧记录缺字段显示未记录。
- 项目运行时新增 `protection` 事件：`direction=input/tool_input/tool_output/output`，`verdict=allow/block/unavailable`，`scope=project/project_sensitive_patterns`。回答的敏感模式检查通过或拒绝可见，但不代表完整语义输出审核；输入/工具阶段拒绝与回答输出拒绝分开记录。

此项目只包含 React 前端。生产入口与下述接口应同源，浏览器不持有模型密钥。

| 方法/路径 | 用途 |
| --- | --- |
| GET `/api/session` | 后端检查来源设备，设置 HttpOnly 会话 Cookie，返回 authorized/cloud/scope |
| GET `/api/health` | 模型 ready、guard_ready、busy、switch、benchmark、cloud_authorized |
| POST `/api/chat` | JSON：messages、mode、scope；响应为逐行 JSON 流 |
| GET `/api/record?id=…` | 已授权会话读取本轮审计，用于补齐 Monitor 信息 |
| POST `/api/switch` | 手动切换互斥加速卡模型，必须由后端再次鉴权 |
| GET `/api/status` | 看板运行服务状态 |
| GET `/data.json` | 看板已整理数据；最少包含 tests、records、counts、source、updatedAt |

准确字段以 `src/lib/types.ts`、`src/features/chat/use-chat.ts` 为准。保留已有服务的 NDJSON 事件，不能替换为 OpenAI SSE 而不加适配器。流可包含阶段、判决、审核结果、token、结束与错误；UTF-8 跨字节块由流解析器处理。

模式：`auto`、`small`（2B）、`standard`（9B）、`large`（27B）、`cloud`；`scope` 为 local/hybrid。手动选择不绕过审核。27B 加载需要独立确认，前端不主动停止 9B。

服务必须自己执行输入 Block、Fail Closed、模型访问控制、来源检查、额度及私有日志保护。前端的按钮禁用和提示不是安全边界。禁止把私有配置、SQLite、聊天日志或 CA 私钥作为静态资源发布。

看板数据使用历史批次兼容适配；缺失指标保持空值。真实批次应保留配置、口径、固定答案、原始回答与导出文件；不要把不同量化和思考模式的差异解释为纯硬件倍数。
