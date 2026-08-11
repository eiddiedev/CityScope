# Event Proposal

所有事件为不可变 envelope：`eventId`、`eventType`、`causeId`、`actorId`、`worldVersion`、`occurredAt`、`payload`。

| eventType | 触发方 | 含义 |
|---|---|---|
| `AgentActionProposed` | Agent/人类接管 | 候选结构化动作产生，尚未改变世界。 |
| `ActionRejected` | Gate | Authority 或 Constraint Gate 拒绝；没有 StateDelta。 |
| `PolicyPackIssued` | 城市负责人 | 正式报价通过规则验证。 |
| `CompanyResponseIssued` | CEO | 企业内部建议形成正式回应。 |
| `FactDisclosed` | 尽调规则服务 | 私有事实按 audience 披露。 |
| `CommitmentApproved` | Reducer | 获批承诺写入账本。 |
| `CommitmentStatusChanged` | Reducer | 履约、违约、撤回或支付。 |
| `StateChanged` | Reducer | 携带一组可追溯 StateDelta。 |
| `CheckpointCreated` | Trace | 固定 WorldState、记忆、承诺、模型/Prompt/seed 快照。 |
| `ForkCreated` | Trace | 从 checkpoint 复制，只新增 interventionId 和单一原因变化。 |
| `SimulationTerminated` | Orchestrator | 达到终止条件；此后才允许分类。 |
| `OutcomeClassified` | Classifier | 对 terminal WorldState 的事后标签。 |

Round 2 约束：`PUBLISH_STAKEHOLDER_REACTION`、`ISSUE_COORDINATION_OPINION`、`AUDIT_POLICY_PACK` 与 `PASS` 都先产生 `AgentActionProposed`，随后由 `StateChanged` 或零 delta 的 DecisionReceipt 表达结果。前端不得把候选当成已执行状态；只消费 `receipt.status=APPLIED` 对应的 delta。

阶段切换由确定性 orchestrator 产生 `StateChanged`，其 `actorId=orchestrator`、`payload.semantic=phase_transition`，不是 Agent 决策。
