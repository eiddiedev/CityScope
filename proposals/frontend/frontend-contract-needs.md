# CityScope 前端契约需求提案

状态：`SUPERSEDED_BY contracts/v0@0.1.0 / REVIEW HISTORY`
审计日期：2026-08-11
审计分支：`work/frontend`
事实基线：主仓库为空；`contracts/`、`fixtures/`、Schema、版本号均不存在。本文件中的字段名和 JSON 只用于契约评审，**不是已冻结业务字段，不得被前端运行时消费**。

## 1. 信息架构

主工作面不是聊天：

1. `TwinWorkspace`：单 Canvas 双城沙盘、中央项目核心、资源流、实时指标槽位。
2. `InstitutionRail`：组织树、正式权限、意见分歧、签署链。
3. `NegotiationSpace`：结构化 PolicyPack、轮次 Diff、候选状态、承担方。
4. `EvidenceInspector`：任意 StateDelta 的 `causeId → AgentAction → 条款/事件 → before/after`。
5. `CausalTimeline`：动作、事件、StateDelta、承诺、履约、失败与重试。
6. `AgentXRay`：目标、权限、事实可见性、私有记忆摘要、红线、承诺、独立效用贡献、立场。
7. `CheckpointForkLab`：同一检查点的 Baseline 与单因干预世界；共享静态底座。
8. `OutcomeCompare`：仅在终止后比较地点、财政、产业、风险、承诺与异议。
9. `EvalArena`：比较单 LLM、朴素群聊、CityScope；各指标带来源，不合成唯一总分。
10. `RuntimeSafety`：Adapter 模式、六态状态系统、WebGL/2.5D 降级、离线 Demo 轨迹校验。

## 2. 总路演 8–10 分钟 / 产品实操 3–5 分钟

| 时间 | 评委操作 | 必须看到的证据 |
|---|---|---|
| 0:00–0:25 | 双城、项目核心与 16 主体总览 | 两城三秒可辨；14 Agent + 2 Service；当前运行模式显著可见 |
| 0:25–1:05 | 看一次部门建议→签发→审计闭环 | eligible actors、候选/PASS、Gate、provenance 与 PolicyPack |
| 1:05–1:35 | 展示超预算候选 | 真实 reasonCode 阻止；0 StateDelta；worldVersion 不变化 |
| 1:35–2:10 | 披露订单风险 | 事实可见范围改变；企业、资本、居民自主重议；变化可追溯 |
| 2:10–2:45 | 从同一检查点只修改一个变量并 Fork | 人类改变原因，不选择结局；单因不变量可验证 |
| 2:45–3:30 | Baseline 与 Intervention 续跑 | 两者调用同一 continuation；共享静态底座；结果开放 |
| 3:30–4:10 | Outcome / Eval / causeId 收束 | Outcome 仅终止后分类；指标有 provenance；任一变化可回溯 |

### 2.1 赛前快速巡检

赛前 smoke test 可压缩到 90 秒，但正式产品实操仍为 3–5 分钟。总路演的其余 4–6 分钟用于 PPT 的问题、创新、架构、评测和总结。

## 3. 组件树

```text
AppShell
├─ RuntimeHeader
│  ├─ AdapterHealth
│  ├─ RunStateBadge
│  └─ PerformanceProbe
├─ TwinWorkspace
│  ├─ SharedRenderer
│  │  ├─ ChengduStaticBase (merged/instanced)
│  │  ├─ ChongqingStaticBase (merged/instanced)
│  │  ├─ SemanticNodeLayer (independent stable nodes)
│  │  ├─ ResourceFlowLayer (instanced density/speed)
│  │  └─ ProjectCore
│  ├─ WorldMetricRail
│  └─ FallbackTwin2D
├─ EvidenceDrawer
│  ├─ OrganizationTree
│  ├─ AgentXRay
│  ├─ PolicyPackDiff
│  ├─ RedlineGate
│  └─ CausalChain
├─ CausalTimeline
├─ CheckpointForkLab
│  └─ SharedBaseForkViews (single Canvas/scissor or snapshots)
├─ OutcomeCompare
└─ EvalArena
```

Adapter 边界：`ApiAdapter` 与 `FixtureAdapter` 实现同一接口；模式选择只发生在 `frontend/src/adapters/`。业务类型只能从 `contracts/` 生成或导入。契约未冻结时载荷维持 `unknown`，不得手写镜像类型。

## 4. 参考项目—前端模块映射

| 参考 | 可迁移概念 | 前端落点 | 明确不迁移 |
|---|---|---|---|
| ASM spec | provenance、操作边界、硬约束、selection/receipt、声明值与实际值分离 | 组织树、Agent X-Ray、红线门、证据检查器 | 不把服务选择 Schema 误当 CityScope 业务 Schema |
| ASM implementation | hard-constraint filter → 多指标贡献；Trust Delta 的 declared/actual 对照 | X-Ray 的独立效用贡献、敏感性、Trust Delta 明细 | 不展示误导性的唯一总分 |
| bisai | Baseline/Candidate gate、不可行候选、repair、回归拒绝 | PolicyPack 候选对比、红线门、修复建议、Eval 回归门 | 不复用其配送业务字段 |
| map3d | OSM footprint/道路、小场景 R3F 组织、GLB 导出 | 离线地理预处理参考 | 不复用每栋楼独立 Mesh + hover/state；不现场 Overpass；不整城加载 |
| VoxCity | 小范围地形/建筑/树木/土地覆盖的离线体素与 OBJ 输出 | 可选静态底座资产流水线 | 不把 Python/GDAL/Earth Engine/体素生成放入演示链路 |
| OSM | 数据来源与 ODbL/署名要求 | 沙盘或关于页常驻署名；资产 manifest 记录来源 | 没有实际 OSM 数据时不虚假声称来源 |

## 5. 页面字段语义需求

以下是**语义槽位**，字段命名由契约负责人决定。

### TwinWorkspace / 实时指标

- 世界快照：唯一标识、版本/序号、模拟时间、运行状态、终止状态。
- 城市与项目：实体标识、实体种类、地点归属、项目倾向或位置表达。
- 指标：指标标识、数值、单位、before、after、delta、`causeId`、更新时间。
- 语义节点：稳定业务 ID、节点种类、城市、施工/运营状态、视觉阶段、最近 delta。
- 资源流：流种类（资金/人才/物流/订单/信任）、源、目标、强度、方向、状态、`causeId`。
- 地理资产：静态资产版本、分块 ID、数据来源、OSM attribution；业务节点到视觉节点的稳定映射。

### OrganizationTree / Agent X-Ray

- Agent：稳定 ID、组织 ID、角色、负责人关系、当前状态。
- Actor Registry 必须精确包含 16 个主体并携带 `actorKind: agent | service`：
  - Agent：`regional_coordinator`、`policy_supervisor`、`chengdu_leader`、`chengdu_investment`、`chengdu_finance`、`chongqing_leader`、`chongqing_investment`、`chongqing_finance`、`company_ceo`、`company_cfo`、`company_board`、`investor`、`talent_sme`、`resident`。
  - Service：`due_diligence_service`、`world_resource_service`。
- OrganizationTree、X-Ray、Timeline 必须用视觉和语义共同区分行为 Agent 与确定性 Service。
- 正式权限：动作种类、资源范围、审批边界、授权来源、有效期。
- 目标与效用：每个 Agent 的独立维度、贡献值、权重来源、敏感性；禁止唯一总分。
- 信息：事实 ID、可见性、来源、置信度、披露时刻；私有记忆只给已脱敏摘要。
- 约束：红线 ID、规则来源、作用范围、是否硬约束。
- 承诺：承诺 ID、条款、主体、对象、状态、截止时间、履约 evidence。
- 立场：结构化倾向/异议及有效时间；自然语言解释只能作为附属证据。
- 私有 observation/memory 默认不得完整下发浏览器；需要 viewer scope、visibility、redaction、authorized summary。评委模式显示脱敏私有信息时必须有明确标识。

### Autonomous / Replay 证据

- Run 必须有 `runMode: autonomous | replay`；主工作面持续显示，禁止以统一 Demo Mode 掩盖差异。
- Autonomous 需要 eligible actors、scheduler phase/reason、Agent candidate 或 PASS、selected/unselected candidates。
- Candidate 需表达 generated、validated、applied、rejected 等生命周期语义，但由 Candidate 自己的合法状态机定义。
- 每次选择需包含 Gate 结果，以及 provider/model/prompt/seed provenance。
- Replay 必须指向原始 Trace/Fixture 版本、校验结果和 replay cursor；不得把回放标成 Autonomous。

### Negotiation / PolicyPack Diff / Redline Gate

- PolicyPack：稳定 ID、版本、父版本、提议者、签署者、状态、有效期。
- 条款：稳定 ID、种类、金额与单位、资源、里程碑、交换条件、承担方、受益方、有效期。
- Diff：add/remove/modify/concede/request；before/after；动作/原因/责任主体。
- Candidate Gate：候选 ID、feasible、reasonCode 列表、规则来源、repair 建议、是否允许重提。
- 必须保证被阻止候选没有 WorldState 变化。

### Timeline / Causal Evidence

- 通用 Trace 事件：ID、种类、顺序号、模拟时间、父事件、`causeId`、关联实体。
- AgentAction：发起 Agent、动作种类、输入来源、权限检查、状态、DecisionReceipt。
- StateDelta：目标、路径或指标 ID、before、after、单位、`causeId`。
- WorldEvent：来源、可见范围、事实变化、可信度。
- DecisionReceipt：输入摘要哈希、约束结果、实际执行结果、签名/验证状态、provenance。

### StakeholderState / 上级与社会反应

- regional coordination opinion。
- policy audit decision：`approve | flag | require_repair` 与 reasonCodes。
- talent_sme reaction 与 resident reaction。
- 指标至少覆盖：talentAttraction、smeParticipation、supplyChainReadiness、housingPressure、residentSupport、fiscalFairnessConcern、trafficOrEnergyPressure、publicTrust。
- 每次 StakeholderState 变化必须包含 typed before/after 和 causeId，不接受自然语言解释替代。

### ResourceLedger / 确定性 ServiceResult

- 资源维度：财政、土地与厂房、能源、人才住房。
- 账本桶：available、reserved、committed、paid、released。
- 请求响应：requested、remaining、feasible、reasonCode、evidence。
- ResourceLedger/ServiceResult 来自确定性 `world_resource_service`，不得由 Agent 自然语言判断替代。

### 领域视觉语义边界

- 领域契约提供 project allocation/affinity；前端映射项目核心颜色、坐标与亮度。
- Project component 状态建议为 `planned | permitting | constructing | operating | paused | abandoned`。
- Semantic flow 提供 kind/source/target/intensity/direction/status/causeId；前端映射粒子密度、速度、曲线和材质。
- 领域契约只提供 stable domain node ID；独立 visual manifest 映射到 GLB/程序化节点，不把像素坐标、颜色或结局过场写进业务 Schema。

### Fork / Outcome / Eval

- Checkpoint：ID、世界版本、Trace offset、静态资产版本、可 Fork 状态。
- Intervention：恰好一种类型；目标；before/after；合法性结果；操作者；父 `causeId`。
- Fork Run：Baseline/Intervention 关系、共享底座引用、独立轻量状态、运行状态、终止状态。
- Outcome：仅终止后可用；分类、地点、财政、产业、风险、承诺、异议；每项有 evidence causes。
- Eval：方法 ID、场景/运行 ID、指标 ID、值、单位、样本数、计算版本、来源、时间；禁止总分。

## 6. Fixture 提案示例（不可执行）

字段名均加 `proposal_`，防止被误认为冻结字段：

```json
{
  "proposal_contractVersion": "TBD",
  "proposal_fixtureVersion": "TBD",
  "proposal_run": {
    "proposal_id": "run-demo-trace-001",
    "proposal_status": "running",
    "proposal_worldSequence": 17
  },
  "proposal_delta": {
    "proposal_id": "delta-017",
    "proposal_targetEntityId": "semantic-node-id-from-contract",
    "proposal_metricId": "metric-id-from-contract",
    "proposal_before": "typed-value-from-schema",
    "proposal_after": "typed-value-from-schema",
    "proposal_causeId": "cause-017"
  },
  "proposal_cause": {
    "proposal_id": "cause-017",
    "proposal_agentActionId": "action-016",
    "proposal_policyClauseId": null,
    "proposal_eventId": "event-order-disclosure",
    "proposal_parentStateSequence": 16
  },
  "proposal_gate": {
    "proposal_candidateId": "candidate-004",
    "proposal_feasible": false,
    "proposal_reasonCodes": ["REAL_REASON_CODE_FROM_CONTRACT"],
    "proposal_repairs": ["STRUCTURED_REPAIR_FROM_CONTRACT"],
    "proposal_producedDeltaIds": []
  }
}
```

合法 Demo Fixture 至少需要覆盖：

- 部门分歧 → 财政反对 → 修订 → 负责人签署 → 正式报价。
- 一次被红线阻止且 `producedDeltaIds` 为空的超预算候选。
- 订单风险事实披露后，各 Agent 独立动作和多条 StateDelta。
- 人类接管修改一个合法条款，其他 Agent 自主响应。
- 同检查点 Baseline 与单因 Intervention 的并行、可回放轨迹。
- 两个不同终止结果及其 cause coverage、承诺履约、异议。
- 单 LLM、群聊、CityScope 的真实 Eval 数据与 provenance。

## 7. Schema、路径与版本要求

- 当前建议路径（等待后端 Gate A，不得标记 FROZEN）：`contracts/v0/schemas/`、`contracts/v0/openapi.yaml`、`contracts/v0/generated/types.ts`、`fixtures/v0/`。
- 首次冻结建议 contract/fixture 版本均为 `0.1.0`，当前不是已批准版本。
- 必须提供稳定命令：`npm run contracts:generate`、`npm run contracts:validate`、`npm run fixtures:validate`；命令真实通过后才能进入冻结验收。
- 根载荷必须携带可比较的契约版本与 Fixture 版本；明确 SemVer 或版本策略。
- CI 用正式 JSON Schema 校验全部 Fixture，前端只消费通过校验的文件。
- 生成 TypeScript 类型的命令和输出目录必须稳定；禁止在 `frontend/` 复制业务接口。
- 统一视觉色板覆盖 pending/running/blocked/invalid/completed/failed，但领域对象不得强行共用一个状态枚举：
  - Run/Fork：pending/running/completed/failed。
  - Candidate：proposed/validating/blocked/invalid/applied/failed。
  - Commitment：approved/due/paid/failed/withdrawn。
  - Semantic node：planned/permitting/constructing/operating/paused/abandoned。
  - PolicyPack 与 Audit 使用各自合法状态机。
- Adapter 负责将领域状态映射到统一视觉色板，同时保留原始状态和值。
- `causeId` 引用必须可解析；Fixture CI 应检查无悬空引用、Delta 前态连续、Fork 单因差异、Blocked 无 Delta、Outcome 仅终止后出现。
- 未知枚举值应由 Adapter 映射为 `unknown` 并保留原值；新增可选字段须向后兼容。

## 8. 兼容影响与降级

- 新增可选证据字段：旧前端显示“证据不完整”，黄金链路继续；不制造推断值。
- 缺少稳定业务节点 ID：只能显示不可编辑背景节点，禁用施工/停工等业务交互。
- 缺少 before/after 或 causeId：动画禁用，指标显示 `untraceable`，不得只播视觉效果。
- 缺少 Diff：显示完整 PolicyPack 版本，不做客户端猜测 Diff。
- 缺少 repair：红线仍阻止，但显示“后端未提供可修复条件”。
- WebGL/性能不足：使用 2.5D SVG/Canvas；同一证据、组织、Fork 和时间线功能保持。
- API/模型/网络失败：仅在合法 Fixture 通过同一 Schema 与 Adapter 后进入 Demo Mode。

## 9. 验收对话所需决定

1. 契约版本策略、Schema 文件位置、TS 类型生成命令。
2. cause graph 的规范形态与跨对象引用规则。
3. WorldState/StateDelta 的值类型与单位表达。
4. PolicyPack 条款联合类型、Diff 生成方、reasonCode 与 repair 结构。
5. Agent 私有信息的脱敏边界与前端授权。
6. Fork 单因不变量、共享状态引用和回放协议。
7. Outcome 的终止门与 Eval 指标来源。
8. Demo Fixture 的签核人、版本与 CI 校验命令。
