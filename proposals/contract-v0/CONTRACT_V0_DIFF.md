# Contract v0 Round 2 Diff

状态：提案差异，不是冻结契约。

| 范围 | Round 1 | Round 2 提案 | 前端影响 |
|---|---|---|---|
| Actor | 未区分 Agent/Service | `actorKind=agent|service`；14 Agent + 2 Service | X-Ray 可禁止给 Service 显示 Prompt/效用。 |
| Action | 主要谈判动作 | 新增 `PASS`、`PUBLISH_STAKEHOLDER_REACTION`、`ISSUE_COORDINATION_OPINION`、`AUDIT_POLICY_PACK`；每类 payload 完整定义 | UI 可按 kind 渲染审计、协调和社会反馈。 |
| Stakeholder | 不存在 | 8 项 `StakeholderState` 指标，范围 0–100 | 人才流、住房压力、居民支持和公共信任无需前端推断。 |
| Resource | 只有总容量 | 五类账户统一为 capacity/available/reserved/committed/paid/released；Gate 返回 `ResourceCalculation` | 资源告警可直接显示 requested/remaining/reasonCode/evidence。 |
| PolicyPack | 无审计与资源回执 | `auditStatus` + `resourceCalculations` | 正式政策是否可接受、为何被阻止均可视化。 |
| WorldState | 多个占位 object/array | 所有嵌套字段、items、additionalProperties 与枚举完整定义 | Ajv 可直接编译，不需要自行发明字段。 |
| Simulation | 未区分模式 | `mode=autonomous|replay`、phase、cycle、`outcomeStatus=pending|classified` | UI 明确标注自主生成与 Fixture 回放。 |
| Semantic | 无严格视觉语义 | `SemanticEffects` 由状态派生，包含建筑、工厂、人才、物流、住房、居民和资源告警 | 动画只跟随因果状态，不读取 winner/desiredOutcome。 |
| API | 仅路径说明 | 9 类响应与错误体 Schema | 前端可生成类型并做运行时验证。 |

兼容策略：本轮仍处于 `proposals/contract-v0`，因此不承诺对 Round 1 占位 Schema 的兼容。冻结时建议把 Round 2 作为 v0 的首个可消费版本，不迁移 Round 1 的空结构。

前端兼容样例由后端生成至 `fixtures/generated/frontend-compatibility.json`，并在测试中通过 Ajv `FrontendCompatibilitySample` 校验。

