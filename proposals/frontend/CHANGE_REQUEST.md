# CHANGE REQUEST — Frontend Evidence Contract

状态：`APPROVED_AS_REQUIREMENTS / CONTRACT_NOT_FROZEN / REVISION 2 INCORPORATED`
发起方：CityScope Frontend
原因：仓库中尚无 `contracts/`、`fixtures/`、版本号或 Schema。前端无法在不发明业务字段的前提下接入黄金链路。

## 所需字段

请求冻结以下**语义能力**的 Schema；具体字段名由契约负责人决定：

- World snapshot、metric before/after/delta、semantic node、resource flow、project position。
- Organization、Agent、正式权限、信息可见性、约束、承诺、独立效用贡献、立场。
- PolicyPack/version/clause、结构化 Diff、candidate feasibility、reasonCode、repair。
- Trace event、AgentAction、StateDelta、WorldEvent、DecisionReceipt、完整 `causeId` 关系。
- Checkpoint、唯一 Intervention、Baseline/Fork run、终止后 Outcome。
- Eval method/metric/value/sample/provenance。
- contract/fixture version；按领域拆分状态机，并由 Adapter 映射统一六态视觉色板。
- 16 Actor Registry（14 Agent + 2 Service）及 `actorKind`。
- `runMode: autonomous | replay`、scheduler/candidate/PASS/Gate/provenance。
- 上级与社会反应闭环、StakeholderState、确定性 ResourceLedger/ServiceResult。
- viewer scope、visibility、redaction、authorized summary。
- stable domain node 与独立 visual manifest 的映射边界。

完整字段语义见 `proposals/frontend-contract-needs.md` 第 5 节。

## 使用页面

双城沙盘、组织树、Agent X-Ray、政企谈判空间、PolicyPack Diff、红线门、因果时间线、Checkpoint Fork Lab、Outcome Compare、Eval Arena、Demo Mode。

## 交互状态

全局只统一视觉表现 `pending`、`running`、`blocked`、`invalid`、`completed`、`failed`；Run/Fork、Candidate、Commitment、Semantic node、PolicyPack、Audit 分别定义合法状态机，Adapter 映射视觉色板。

## Mock JSON（仅用于评审，不可执行）

```json
{
  "proposal_contractVersion": "TBD",
  "proposal_fixtureVersion": "TBD",
  "proposal_stateDelta": {
    "proposal_id": "delta-id",
    "proposal_target": "entity-or-metric-id",
    "proposal_before": "schema-typed-value",
    "proposal_after": "schema-typed-value",
    "proposal_causeId": "cause-id"
  },
  "proposal_gateDecision": {
    "proposal_candidateId": "candidate-id",
    "proposal_status": "blocked",
    "proposal_reasonCodes": ["CONTRACT_ENUM_VALUE"],
    "proposal_repairs": [],
    "proposal_producedDeltaIds": []
  }
}
```

## 兼容影响

- 前端业务类型将改为从契约生成/导入；当前 Adapter 的 `unknown` 边界保持兼容。
- 建议新增字段默认可选；未知枚举保留原值并显示 `unknown`。
- `causeId`、before/after、版本号属于黄金链路关键字段，不应静默缺省。
- Fixture 需增加引用完整性、前态连续性、Blocked 无 Delta、Fork 单因和 Outcome 终止门校验。

## 降级方案

- 契约未批准：只交付明确标注的视觉静帧、性能探针和 Adapter 外壳，不运行伪造轨迹。
- 部分证据缺失：禁用对应动画/操作，显示 `untraceable` 或“证据不完整”。
- API/网络失败：仅当合法 Fixture 通过正式 Schema 后启用 Demo Mode。
- WebGL 失败：切换 2.5D SVG/Canvas，保留全部制度证据与操作入口。

## 请求验收

需求方向已于 2026-08-11 批准，但 Schema/字段/版本/Fixture 尚未冻结。等待后端 Gate A 提供并真实通过 `contracts:generate`、`contracts:validate`、`fixtures:validate`，以及至少一条签核 Trace。此前前端不会声称真实 API、Autonomous Mode 或 Demo Fixture 已接通。
