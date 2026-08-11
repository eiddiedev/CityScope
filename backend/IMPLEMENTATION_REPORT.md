# CityScope Backend Implementation Report

日期：2026-08-11  
分支：`work/backend-agent`  
状态：本地实现完成，未 push、未建 PR、未合并 main。

## 1. 本轮完成的可验证能力

- 从空远端仓库建立独立后端分支；没有假装存在 `contracts/` 或既有代码。
- 14 个 Manifest（上级、成都、重庆、企业、资本和规则服务），每个角色有独立权限、红线、私有事实范围和效用维度；成都与重庆使用不同目标权重。
- Authority / Privacy / Constraint Gate 均位于 World Reducer 前；被拒动作保持原 worldVersion 且没有 StateDelta。
- 城市部门只有建议权，负责人显式选择招商方案、财政方案、折中或退回后才能签发 PolicyPack。
- CEO/CFO 分别建议；董事会必须收齐双方意见后才能签发企业正式回应、接受政策或退出项目。
- 尽调事实在第二轮才可披露；披露后同步更新订单质量、信任、融资信心、项目可行性与项目阶段。
- 承诺账本把 PolicyTerm 编译为 payer、amount、trigger、deadline、failureAction；支持 approved、paid、failed、withdrawn，并把支付或违约后果写回财政、可信度、信任和项目阶段。
- 每个世界变化都产生 `causeId/before/after/actorId/worldVersion`，DecisionReceipt 保存 Gate 结果、证据 digest 和 delta。
- Checkpoint 固化 WorldState、Agent Memory、承诺、Prompt/模型/seed；Fork 只允许一项 intervention，并验证分支除声明变化外完全相同。
- OutcomeClassifier 在非 terminal 状态会拒绝；只读取 terminal WorldState，不接收用户期望结局。
- Qwen Provider 使用 OpenAI-compatible HTTP、环境变量、超时、并发限制、结构化输出、一次修复与 deterministic fallback；业务层只依赖 `LLMProvider`。
- 缓存键含需求规定的七项字段，并额外加入 run/intervention/observation digest，避免平行世界串缓存。
- `/api/v0` 支持 run、action、advance、events、checkpoint、fork、replay、trace、outcome 和乐观锁；`/healthz` 显示 Demo Mode。
- 完全断开模型时 StubProvider 可完成 17 动作黄金链路，并生成前端可消费 Fixture。

黄金运行证据：17 个成功动作、42 个 StateDelta、45 个事件、3 个承诺；四个 Fork 完整性全部通过，独立续跑后标签为 `CHENGDU_LED / DUAL_CITY / CHENGDU_LED / PROJECT_EXITED`。这些标签是 terminal state 的事后分类，不是 intervention 中的目标字段。

## 2. 修改文件及目录所有权

只修改授权目录与空仓库根部基础配置：

- `backend/`：领域类型、Manifest、规则门、Reducer、Provider、Orchestrator、Trace、API、测试与本报告。
- `prompts/`：成都、重庆、企业 Prompt 版本说明。
- `evals/`：baseline 方法与可执行评测。
- `fixtures/generated/`：后端运行生成的黄金轨迹与评测报告。
- `proposals/contract-v0/`：Schema、事件、API、错误码和评审请求。
- 根部：基础 README、package/TypeScript 配置、gitignore。

未创建或修改 `frontend/`、`docs/judge/`、`contracts/`。

## 3. 测试命令与真实结果

```text
npm run build
  PASS — TypeScript 0 errors

npm test
  PASS — 4 test files, 17 tests passed

npm run demo
  PASS — DEMO_MODE; 17 applied, 0 rejected, 42 deltas, 45 events

npm run eval
  PASS — generated fixtures/generated/baseline-report.json

HTTP smoke:
  GET /healthz -> 200, demoMode=true
  POST /api/v0/runs -> worldVersion=0, seed=99
  POST /runs/http_smoke/advance If-Match:0 -> worldVersion=12, receipts=12, deltas=26
  GET /events?afterVersion=10 -> 4 ordered events
```

Baseline 结果：

| Baseline | Violation ↓ | Trace | Commitment | Branch | Diversity | Replay |
|---|---:|---:|---:|---:|---:|---:|
| 单 LLM | 0.60 | 0.00 | 0.00 | 0.00 | 0.25 | 0.00 |
| 朴素多 Agent 群聊 | 0.35 | 0.10 | 0.00 | 0.00 | 0.25 | 0.25 |
| CityScope | 0.00 | 1.00 | 1.00 | 1.00 | 0.75 | 1.00 |

前两个是受限 baseline fixture；CityScope 数值由真实运行计算。方法详见 `evals/README.md`。

## 4. contracts 影响

`contracts/` 不存在，本轮没有创建或修改冻结契约，因此不需要 CHANGE_REQUEST。

所有候选契约均位于 `proposals/contract-v0/`，状态为 `PROPOSED`。需要产品/验收负责人按 `REVIEW_REQUEST.md` 明确批准后才能提升为 `contracts/`。

## 5. 当前风险、尚未完成和下一步

- 未提供真实 `QWEN_API_KEY/QWEN_BASE_URL/QWEN_MODEL`，因此只验证了 Provider 边界、fallback、缓存和超时实现，没有对真实百炼账号做集成调用。
- API 当前为单进程内存存储，适合 8–10 分钟 Demo；生产持久化、SSE、鉴权和多实例一致性尚未实现。
- baseline 中单 LLM/群聊数值来自明确标注的 evaluator fixture；下一步应接入真实多次模型采样并给出置信区间。
- Contract v0 尚待评审，前端接入前应冻结字段、事件名、错误码、金额单位和流式方式。
- `bisai` 未发现根 LICENSE，本实现只参考方法，没有复制其代码；若要直接复用必须先获得许可证澄清。

建议下一步：先审批 `contract-v0`；批准后生成 `contracts/` 单一事实源并让前后端共同跑 schema compatibility test，再用指定百炼模型做固定 seed 的 20 次回放和延迟/失败注入测试。

