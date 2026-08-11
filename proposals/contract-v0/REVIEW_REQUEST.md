# Contract v0 Round 2 Review Request

状态：`ROUND_2_PROPOSED`。第一轮结论 `CHANGES_REQUESTED` 已保留；请勿在复审前提升到 `contracts/`。

## P0 复审清单

- [ ] `ActorManifest` 是否接受 14 个 `actorKind=agent` 与 2 个 `actorKind=service`；Service 无 Prompt/效用。
- [ ] `PASS`、社会反应、区域协调和政策审计 action/payload 是否可冻结。
- [ ] `StakeholderState` 八项指标及 0–100 范围是否满足前端。
- [ ] 五类资源账户和 `ResourceCalculation` requested/available/reserved/remaining/reasonCode/evidence 是否可冻结。
- [ ] PolicyPack 的 `auditStatus`、资源 reservation/commit/release 生命周期是否可冻结。
- [ ] Autonomous phase、eligible actor 和 `outcomeStatus=pending|classified` 是否可冻结。
- [ ] Checkpoint/Fork、Trace、DecisionReceipt、Event 与 API 响应 Schema 是否可冻结。
- [ ] `SemanticEffects` 派生视觉语义是否足够且不含 winner/desiredOutcome。
- [ ] `fixtures/generated/frontend-compatibility.json` 能否被前端直接消费。

## 验证证据

- `npm test` 包含精确主体数量、自主行动、统一 Fork continuation、seed 差异、资源生命周期、Fork 隔离与 Ajv compatibility。
- `npm run demo` 分开输出 `AUTONOMOUS_MODE` 和 `REPLAY_DEMO_MODE`。
- `CONTRACT_V0_DIFF.md` 给出 Round 1 → Round 2 字段及调用方影响。

请产品/验收负责人逐项回复 `APPROVE` 或 `CHANGES_REQUESTED`。只有全部 P0 获批后，才创建 `contracts/` 单一事实源。

