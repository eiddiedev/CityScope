# CityScope 中央整合验收

日期：2026-08-11
分支：`work/integration`

## 结论

前后端已从两条独立实现整合为同一主仓库、同一冻结契约和同一签名 Fixture。产品方向与最初北极星一致：用户改变原因，不选择结局；Agent 在规则约束下续演；前端只播放可追溯世界变化。

当前状态适合进入黑客松 Demo 打磨。DeepSeek 已完成新版两轮流程的真实单轮验收，但多次延迟/稳定性评测尚未完成，不能宣称生产级。

## 已通过

| 验收项 | 证据 |
|---|---|
| 主体精确 | Runtime Registry 为 12 个行为 Agent + 4 个确定性 Service；共 16 个可视化主体，前端测试逐个统计。 |
| 自主调度 | 每阶段从 eligible actors 派生候选；不存在完整预写 action list。 |
| 开放结局 | OutcomeClassifier 只接受 terminal WorldState；代码未按 runId、fork index 或期望标签选动作。 |
| 权限与资源 | Authority / Privacy / Constraint Gate 均在 Reducer 之前；拒绝候选 0 StateDelta。 |
| 企业治理 | CEO、CFO 分别建议，董事会收到两方意见后才正式决定。 |
| 董事会终局 | 风险披露后必须明确接受政策、提交具体反报价继续谈判或退出；未形成结论的 PASS 会被 Gate 拒绝。 |
| 阶段语义 | 只有已接受政策可以进入履约；继续谈判或退出会跳过资源履约服务，直接进入社会反馈。 |
| 双城治理 | 两城招商、财政、负责人分离；区域协调与审计权限独立。 |
| 正式四结局 | 成都主导、重庆主导、双城协调、两城退出分别依赖不同的撤回/响应/审计/董事会正式行动链；不再以“接受两个政策包”冒充协作。 |
| 两轮风险重估 | 尽调后两城部门重新建议，负责人可修订或撤回；未审计 v2 不可被董事会接受。 |
| 组织信息隔离 | 两城部门建议、企业 CEO/CFO 意见、Agent memory 与协调线程均按组织、负责人和 audience 过滤；越权引用由 Privacy Gate 拒绝。 |
| 协调回复链 | 协调方与两城负责人完成六轮有 `replyToMessageId` 的受限谈判后，才能签发带摘要和双方让步的正式协调意见。 |
| 事实披露 | 尽调事实第二轮披露，并改变后续 Observation、信任、融资与可行性。 |
| 单因 Fork | 干预路径有 allowlist、类型与范围校验；Baseline / Intervention 共享 Checkpoint 与 continuation。 |
| 因果证据 | 每个世界变化都有 causeId、before、after、actorId、worldVersion。 |
| 组合优化 | OR-Tools CP-SAT 产生 5 个硬约束可行且互异的功能布局，TypeScript 侧再次独立验算。 |
| 多目标决策 | 10 类关键角色使用不同 TOPSIS 权重；完整中间矩阵、理想解、距离和接近度均可追溯。 |
| 算法进入 Agent | 在线模型、离线 Stub 与模型失败 fallback 都接收同一 DecisionPortfolio，并在理由中引用 candidateId。 |
| 长期政策结果 | 终局后以规则服务计算 12/24 月投资、就业、订单转化、产能利用、补贴与财政/社会影响；“赢得招商”和“政策成功”分开展示。 |
| 前端契约 | 前端类型从 `contracts/v0/generated/types.d.ts` 导入，不维护第二套业务模型。 |
| 视觉降级 | WebGL 沙盘带性能探针；可切换 2.5D fallback。 |

## 本轮真实回归

- 后端：10 个测试文件、60 项通过。
- 前端：3 个测试文件、18 项通过。
- TypeScript：后端与前端均 0 错误。
- Fixture：16 主体、41 步（含风险重估、政策 v2、六轮协调回复、双方正式响应、重新审计、董事会终局和长期影响）、4 Fork、红线候选 0 Delta，通过 Schema 与引用/终态/Fork 不变量。
- HTTP Live Fork：在 `due_diligence` 后检查点只将 `metrics.financingConfidence` 从 40 改为 5；Baseline 终态为 `DUAL_CITY`，Intervention 终态为 `PROJECT_EXITED`，两条运行均正常终止。
- 当前签名 Fixture：Baseline `DUAL_CITY`；四个干预分支分别为 `CHENGDU_LED / CHONGQING_LED / DUAL_CITY / PROJECT_EXITED`，四类终局均由不同正式行动链成立。
- DeepSeek V4 Flash：真实主世界约 94 秒、27 个调度步骤、0 最终拒绝；董事会提交具体反报价后进入 `renegotiation`，资源履约服务未执行，结果证据记录为 `decision=continue_negotiation`。模型或Gate失败由确定性合法候选兜底，但不会隐藏此前的拒绝证据。
- 新版两轮 DeepSeek 热缓存复验：约 34 秒、41 步、57 个世界版本、0 个最终拒绝；12 个当前动作由模型生成、16 个来自新版精确语义缓存、4 个非法结构经一次修复后使用确定性合法 fallback、9 个规则服务动作。最终自然形成 `DUAL_CITY`，120 个 StateDelta 可追溯。
- 最终协议冷启动复验：约 70 秒、41 步，29 个模型动作、9 个规则服务、3 个合法 fallback、0 个最终拒绝，仍自然形成 `DUAL_CITY`；最终联合方案生成 2 条可执行承诺，120 个 StateDelta 可追溯，19 个关键行动引用算法候选。“两城各至少一项分期兑现条款”已成为 Schema 硬门槛。
- 新版算法证据：27 个事件含 DecisionPortfolio，求解器均为 `ortools-cp-sat`；15 个关键行动引用候选，覆盖两城负责人、CEO、CFO、投资机构、协调、审计和董事会。
- 1080 次离线敏感性：6 变量 × 9 值 × 20 seed，合法率 100%、0 未决、四结局全部可达；6 个变量的配对结局变化率都能达到 30%。默认 20 seed 为 16 次双城协作、4 次成都主导，最大单结局占比 80%，所以协作是高概率但非固定答案。
- 协调协议真实复验：运行至 `coordination_debate` 共 14 个行动，其中 11 个由 DeepSeek 生成、3 个使用确定性合法降级。协调线程包含 6 条依次引用前文的消息，正文分别形成成都研发底线、重庆制造底线、功能拆分、补贴边界和双方让步；最后由协调 Agent 独立签发结构化摘要。该结果不是 Fixture 回放。
- 页面回归：真实 API 使用 `deepseek-v4-flash`；离线回归验证谈判三列舞台、41 步黄金链路、结局复盘和默认折叠的技术证据，前端 18 项测试与生产构建通过。

完整回归命令：

```bash
npm run check
```

## 仍需完成

1. 固定场景至少运行 20 次 DeepSeek，记录成功率、平均延迟、P95、Schema修复率、Gate修复率与 fallback 率；当前只有新版单轮真实证据。
2. 将 Live Fork 优化为读取已经验证的演示 Checkpoint，只现场续演干预分支，避免真实模型重复跑完整 Baseline。
3. 用真实采样替换单 LLM / 朴素群聊两组 evaluator fixture，并给出样本数和置信区间。
4. 完成 20 次连续路演彩排和录屏备份；确认 1280×720 投影下文字可读。
5. 若要部署，再增加持久化、SSE、鉴权、限流与多实例一致性；这些不属于当前 48 小时 Demo 必需项。

## 方向锁

后续细节优化不得改变以下事实：主界面不是聊天；Service 不由 LLM 决定资源和权限；用户不能选择结局；关键动画必须来自 StateDelta；Fixture/Stub/真实模型模式必须如实标识。
