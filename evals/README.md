# Baseline Evaluation

三个 baseline 使用同一“星岚机器人西部扩张”输入。指标范围均为 0–1（越高越好，Constraint Violation Rate 除外）：

- **Constraint Violation Rate**：独立规则检查发现的越权、超预算、隐私和红线违规 / 总候选动作。
- **Causal Trace Coverage**：有可解析 causeId、before、after、actorId、worldVersion 的状态变化占比。
- **Commitment Consistency**：正式承诺、财政占用和触发支付一致性。
- **Branch Integrity**：Fork 除声明的单一 intervention 外与 checkpoint 相同的比例。
- **Outcome Diversity**：固定起点的四个干预分支中不同 terminal 标签数 / 4。
- **Replay Stability**：固定 snapshot/seed/action 序列的 digest 一致率。

单 LLM 与朴素群聊是明确的受限 baseline fixture，不声称拥有它们没有实现的状态、Gate 或回放能力。CityScope 指标由真实黄金运行计算。

