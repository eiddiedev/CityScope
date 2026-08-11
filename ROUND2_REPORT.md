# CityScope Backend Round 2 Report

状态：`REVIEW_REQUEST`。本轮只修改 `proposals/contract-v0/`，没有创建或提升 `contracts/`。

验证命令：`npm run check`（TypeScript build、Vitest、Demo、Eval）。结果：6 个测试文件、25 项测试全部通过。

## A. Autonomous Mode

入口是 `continueAutonomously(engine, context)`。调用方只提供 WorldState、seed、最大步数和可选的单原因 intervention；若传入完整 `actions` 数组，立即返回 `AUTONOMOUS_ACTION_LIST_FORBIDDEN`。Qwen 和 deterministic Stub 共用同一个 eligible actor 调度、Gate 与 Reducer。

本次生成 Fixture 的实际阶段和 eligible actor 顺序：

1. `internal_advice`：成都招商、成都财政、重庆招商、重庆财政
2. `policy_formation`：成都负责人、重庆负责人
3. `policy_audit`：政策监督、区域协调
4. `stakeholder_reaction`：人才/中小企业、居民
5. `company_deliberation`：CEO、CFO、投资人、董事会
6. `due_diligence`：政策监督、尽调 Service
7. `post_disclosure`：人才/中小企业、居民、区域协调、政策监督、CEO、CFO、投资人、董事会
8. `delivery`：世界资源 Service
9. `delivery_reaction`：人才/中小企业、居民

根世界实际产生 28 个候选：4 `ADVISE_POLICY`、2 `SUBMIT_POLICY_PACK`、1 `AUDIT_POLICY_PACK`、1 `ISSUE_COORDINATION_OPINION`、6 `PUBLISH_STAKEHOLDER_REACTION`、4 `ADVISE_COMPANY_RESPONSE`、2 `ADVISE_FINANCING`、1 `SUBMIT_COMPANY_RESPONSE`、1 `REQUEST_DUE_DILIGENCE`、1 `DISCLOSE_FACT`、2 `PASS`、2 `ACCEPT_POLICY`、1 `ADVANCE_PROJECT`。其中区域协调与政策监督在风险披露后各产生一次合法 `PASS`。

全部候选均形成 DecisionReceipt，并经过同一 Gate/Reducer；根世界政策包在资源边界内，因此本次黄金轨迹的 Gate 拒绝数为 0。资源超限和重复占用的真实 Gate 拒绝由 `resources.test.ts` 构造并验证，回执包含 requested/available/reserved/committed/paid/released/remaining/reasonCode/evidence。

根世界累计 86 个 StateDelta、76 个 Event、4 个 Commitment，终态语义为双城拆分、研发楼和工厂运营、人才流入、物流活跃、居民支持。Outcome 在终态前一直是 `pending`，终态后才由 OutcomeClassifier 得到 `DUAL_CITY`。

四个 Fork 均从 version 22、digest `59c42de71ff0399fe2135d759e47162667200c9cd07d58888336191307029282` 的同一 Checkpoint 出发，并调用同一个 continuation：

| 单原因 intervention | 自主行为差异 | 终态分类 |
| --- | --- | --- |
| publicTrust 71 → 81 | 重新产生利益相关者、协调、审计、企业和履约行动 | `CHENGDU_LED` |
| supplyChainReadiness 64 → 76 | 同一 eligible 阶段下生成不同 actionId/观察依据 | `CHENGDU_LED` |
| investmentPlan 3000 → 2200 | 企业按缩小后规模重新决策 | `CHENGDU_LED` |
| financingConfidence 40 → 5 | 董事会转为退出，资源释放，项目 viability 归零 | `PROJECT_EXITED` |

源码和请求均不按 fork index、runId、name 或 outcome 标签选择业务动作。相同 seed 可逐项回放；不同 seed 或单原因 intervention 会改变候选，但仍必须通过 Schema、权限和资源 Gate。

证据：`fixtures/generated/autonomous-run.json`。

## B. Replay/Demo Mode

第一轮手写 Fixture 被保留为明确的 `REPLAY_DEMO_MODE`，不再称为 Autonomous Mode。它不访问网络，共回放 18 个动作；重复回放 digest 均为 `a718921954d1e7c55051d713e873f3e084ac633473c330ae4fad03b83ab97489`。

证据：`fixtures/generated/replay-demo.json`。

## C. 16 个主体及实际行动

| 主体 | actorKind | 黄金自主链路中的实际行动 |
| --- | --- | --- |
| regional_coordinator | agent | `ISSUE_COORDINATION_OPINION`、`PASS` |
| policy_supervisor | agent | `AUDIT_POLICY_PACK`、`REQUEST_DUE_DILIGENCE`、`PASS` |
| chengdu_leader | agent | `SUBMIT_POLICY_PACK` |
| chengdu_investment | agent | `ADVISE_POLICY` |
| chengdu_finance | agent | `ADVISE_POLICY` |
| chongqing_leader | agent | `SUBMIT_POLICY_PACK` |
| chongqing_investment | agent | `ADVISE_POLICY` |
| chongqing_finance | agent | `ADVISE_POLICY` |
| company_ceo | agent | 两次 `ADVISE_COMPANY_RESPONSE` |
| company_cfo | agent | 两次 `ADVISE_COMPANY_RESPONSE` |
| company_board | agent | `SUBMIT_COMPANY_RESPONSE`、两次 `ACCEPT_POLICY` |
| investor | agent | 两次 `ADVISE_FINANCING` |
| talent_sme | agent | 三次 `PUBLISH_STAKEHOLDER_REACTION` |
| resident | agent | 三次 `PUBLISH_STAKEHOLDER_REACTION` |
| due_diligence_service | service | `DISCLOSE_FACT` |
| world_resource_service | service | `ADVANCE_PROJECT` |

14 个 Agent 均具有独立 utility、redLines、observation scope、memory scope、结构化 action 权限和 Prompt。2 个 Service 没有 Prompt、效用或自由语言谈判，只执行确定性服务逻辑。

## D. 资源工具与测试

`backend/src/rules/tools/resource-ledger.ts` 提供财政、土地与厂房、能源、人才住房四类纯函数计算器，以及 reserve/commit/pay/release 生命周期。账户统一记录 available、reserved、committed、paid、released，并以 policyId 持有 allocation，避免跨 PolicyPack 重复使用。

专项测试覆盖：

- 四类计算器的精确边界与超限；
- 第二个 PolicyPack 重复占用时 Gate 拒绝；
- reservation → commitment → payment/release；
- PolicyPack 拒绝/退出后的资源释放；
- 从同一 Checkpoint 复制的 Fork 账本互不污染。

## E. contract-v0 diff 与前端样例

完整 Schema 位于 `proposals/contract-v0/contract.schema.json`，并由三个根 Schema 引用。新增并完整定义 Actor/Agent/Service、所有 Action payload、PASS、StakeholderState、资源账本与计算回执、GateResult、DecisionReceipt、Event、Trace、Checkpoint/Fork、Simulation、SemanticEffects、API response 和错误结构；Schema 中没有无 items/properties 的占位 object/array。

视觉语义严格从状态派生，包括项目倾向、研发楼/工厂阶段、人才流、物流流、住房压力、居民支持和资源告警，不含 winner、desiredOutcome 或预设动画结局。

Ajv Draft 2020-12 compatibility tests 会验证全部 Manifest、自主行动、WorldState、Trace 和前端样例。前端可直接使用 `fixtures/generated/frontend-compatibility.json`；字段迁移表见 `proposals/contract-v0/CONTRACT_V0_DIFF.md`。

## F. Qwen 接入状态

本次验收运行没有接通真实 Qwen：`qwenConnected=false`。生成来源明确记录为 `deterministic_stub` 或 `deterministic_service`，不冒充模型自主性。

QwenProvider 已适配相同的 observation、eligible phase、结构化输出、Gate 和 Reducer；只有配置有效 Qwen endpoint/key 后才会报告真实模型连接状态。Stub 是基于 Manifest、observation、state 与 seed 的 deterministic policy，不接收或原样返回完整 fallbackAction，也不读取分支编号或 Outcome 标签。
