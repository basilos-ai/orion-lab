# Agent工具协议与最终格式

协议agent-protocol-v2通过既有AI Gateway文本能力传输，仍由Pi执行显式工具。Laya分类输入、门限、缓存与模型范围约束保持原版本；工具协议能力不等同于原生function calling。

| 对象 | 字段 | 用户展示 |
| --- | --- | --- |
| 工具 | type=tool、name、arguments | 参数完整校验后交给Pi，不展示原始协议 |
| 文本最终回答 | type=final、format=text、content | content真实增量流 |
| JSON最终回答 | type=final、format=json、data | 完整校验后只展示data对象 |

每条任务固定output要求，API可显式提交`output:{format:'json',schema:{...}}`；缺省只根据当前用户的明确JSON输出要求识别格式，不从文件或历史指令推断。未明确要求时为text。schema为有限子集：type、properties、required、additionalProperties、items、enum；最大4096字符、6层，定义结构，不提供标准答案。JSON最终结果首版要求对象根节点。

适配层每轮保留固定输出要求，把工具结果标记为不可信数据。兼容严格的旧tool/arguments、answer对象；旧answer在JSON任务中仍须可解析且满足schema。重复键、非有限数值、多对象、围栏、截断、非法工具、额外参数及任务模式之外的工具均拒绝。没有基于大括号截取、正则抽取业务答案或猜测字段值的修复。

仅已识别为最终回答的格式错误可自动纠正一次；普通文本已有可见预览时不纠正。识别条件包括明确final对象，以及JSON任务收到已审核工具结果后返回完整业务对象而遗漏信封；后者不能含工具形状字段。完成的final前缀语法错误可纠正，重复键、非有限数及上游length截断直接停止。纠正使用原模型、scope、decision_id与任务lease，关闭工具；不重放工具、不复制旧审批、不跨模型切换。重复错误、模糊对象、非法工具、敏感草稿、取消和额度不足停止。纠正也经过Gateway输入Block与Monitor，计入云端额度、用量和总耗时。

私有审计逐次保留agent_dispatch、agent_gateway、agent_usage（含attempt）；agent_protocol记录安全的校验结果，不存原始非法草稿。Node从回环`/agent/telemetry`读取当前lease的有序结果，转成protocol_attempt／format_repair事件。前端正常时只显示回答，纠正时显示“正在校正回答格式”，校验及次数在详情。内部接口不对局域网开放。

模型SSE每轮最终usage合计原始与纠正尝试，真实账单仍以Gateway回执为准；失败轮次也保留私有usage和请求ID。完成状态只代表模型流程结束，业务JSON合法、结构符合、答案正确、实际执行工具和任务通过率分别统计。

实测看板`#agent-protocol`读取独立`assets/agent-protocol.json`。保留原Agent路由实验、模型data.json及附件；生产成绩不纳入公开examples。先完成协议阶段验收，再进行后续Laya实验，不把两类改动混在同一批结果中。

## v2.2：9B约束生成与云端诊断

9B使用运行时原生JSON Schema约束采样，限制为当前模式允许的工具对象或固定输出格式的final对象。工具参数关闭额外属性，纠正轮Schema仅含final；解析器、Pi权限、路径与逐次审批仍独立校验。Schema约束结构，不提供业务正确答案，不保证任务语义正确。

当前AI Gateway文本编解码器不接受response_format。请求仍以原文本协议通过Gateway输入Block与Laya Monitor，在已认证的本地模型适配入口附加response_format，不修改AI Gateway。`agent_constraints.py`保存仅内存的一次性合约，绑定物理模型和完整消息（含system），随机句柄、180秒有效、最多8条；只有受控Agent lease能登记。无匹配的普通聊天不注入。Agent收到响应时必须确认合约已应用，否则在发布任何内容或工具前停止。完成、失败均清除合约；重启不恢复在途合约。

新增agent_constraint私有审计标记；protocol_attempt成功项附加canonical与constrained。原始派发、格式规范化（本版本未引入）、模型格式纠正、工具执行和答案正确分别计数。每任务第一次工具请求与每个模型回合的首次输出分开统计；纠正后通过不算首次有效。

云端提示明确要求工具JSON结束后立即停轮，不模拟工具结果、system标签或第二个对象。完整JSON后追加虚构工具结果属于协议污染，不截取第一个对象放行，也不自动重放工具。云端仍使用文本协议，不声称启用了原生JSON模式。上游HTTP错误单独记录agent_transport_error（HTTP、请求ID、耗时、scope、attempt和无自动重试）；protocol_attempt标记failure_stage=upstream，不算JSON语法失败。

上游错误不跨模型回退、不隐藏重试，也不提高云端日限额。30秒附近的provider_unavailable需要关联Gateway回执与服务日志；仅延迟吻合不能断言具体网络根因。部署者保留私有证据、失败和旧版本JSON，公开源码仅提供空示例。Laya继续使用原版本，后续单独评估。
