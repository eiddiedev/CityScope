# 组合优化与评测方法来源

CityScope 的在线求解器是面向政企政策组合重新建模的 OR-Tools CP-SAT 模型，不执行大模型生成的任意代码，也没有复制配送领域的骑手、任务束、接单概率、位图或局部搜索变量。

本项目经用户授权，参考其自有仓库 `Duskriver/courier-delivery-solver` 的以下工程方法：

- `Evaluation` 风格的输入解析、解合法性验证、目标计算与失败记录分离；
- objective 与 fitness 分离；
- 候选去重、排序、超时保护和批量回归；
- E1/E2/M1/M2 仅作为离线参数搜索思路。

这些方法在 CityScope 中分别落为：

- `CityScopeSolutionValidator`：重新核验 CP-SAT 返回的功能分配与资源约束；
- `ScenarioEvaluator`：检查正式行动链、Gate、因果、终局和长期影响；
- `run-sensitivity.ts`：固定版本场景上的批量敏感性测试。

若后续直接引入 LLM4AD/EoH 框架实现，应保留其原始许可证与署名。当前在线 Demo 不包含自修改算法，也不会在运行时生成或执行 Python 求解代码。
