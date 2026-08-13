# Baseline Evaluation

三个 baseline 使用同一“星岚机器人西部扩张”输入。指标范围均为 0–1（越高越好，Constraint Violation Rate 除外）：

- **Constraint Violation Rate**：独立规则检查发现的越权、超预算、隐私和红线违规 / 总候选动作。
- **Causal Trace Coverage**：有可解析 causeId、before、after、actorId、worldVersion 的状态变化占比。
- **Commitment Consistency**：正式承诺、财政占用和触发支付一致性。
- **Branch Integrity**：Fork 除声明的单一 intervention 外与 checkpoint 相同的比例。
- **Outcome Diversity**：固定起点的四个干预分支中不同 terminal 标签数 / 4。
- **Replay Stability**：固定 snapshot/seed/action 序列的 digest 一致率。

单 LLM 与朴素群聊是明确的受限 baseline fixture，不声称拥有它们没有实现的状态、Gate 或回放能力。CityScope 指标由真实黄金运行计算。

## 差异化验收

```bash
npm run eval:sensitivity
npm run eval:deepseek
```

`eval:sensitivity` 从开局 Checkpoint 对 6 个变量、9 个值和 50 个稳定画像 seed 运行 2700 个 Stub 分支，输出四终局可达性、配对变化率、强干预率、方向趋势、合法率和失败码。它只验证规则、优化器、决策边界和因果方向；Stub 的默认分布是诊断信息，不作为真实 Agent 的概率校准结果。

`eval:deepseek` 默认运行 20 条基准与 6×5 条配对干预，共 50 条真实模型轨迹；它才负责真实结局概率、Agent 差异化、模型/合法缓存率、fallback、关键行动证据覆盖、正式行动链和因果吸收层。可用 `CITYSCOPE_DEEPSEEK_DEFAULT_RUNS`、`CITYSCOPE_DEEPSEEK_PAIR_SEEDS` 和 `CITYSCOPE_DEEPSEEK_RUN_CONCURRENCY` 做小样本烟雾测试。

两份报告必须一起看：矩阵证明“机制能否产生差异”，DeepSeek 验收证明“真实 Agent 是否真的作出了差异化决策”。不要求二者概率分布相同。
