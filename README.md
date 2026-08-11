# CityScope Backend

CityScope 是一个开放结局的政企多 Agent 推演底座。本分支从空仓库开始，只包含后端负责人拥有的目录；`contracts/` 尚不存在，候选契约位于 `proposals/contract-v0/`，在产品/验收负责人批准前不提升为单一事实源。

## 可运行能力

- 11 个具有独立权限与私有观察范围的 Agent Manifest。
- Agent 只生成结构化 `AgentAction`；Authority Gate 和 Constraint Gate 在 World Reducer 前执行。
- 组织内建议、负责人正式 PolicyPack、企业正式回应、尽调披露、承诺账本与可追溯 StateDelta。
- 固定 seed 的 Checkpoint、Replay 和只改变一个原因的 Fork。
- Qwen OpenAI-compatible Provider、超时、并发限制、缓存、一次修复和确定性 fallback。
- 完全离线 Demo Mode 与三个 baseline 的指标报告。

## 快速开始

```bash
npm install
npm run check
```

真实模型接入只从后端环境变量读取：

```bash
LLM_PROVIDER=qwen \
QWEN_API_KEY=... \
QWEN_BASE_URL=https://YOUR_WORKSPACE.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 \
QWEN_MODEL=YOUR_EXACT_MODEL_ID \
npm run demo
```

未配置或调用失败时自动进入确定性 Stub/fallback；密钥不进入日志、Fixture 或 Git。

## 参考项目复用矩阵

| 参考 | 许可证核验 | 结论 | CityScope 用法 |
|---|---|---|---|
| [ASM spec](https://github.com/YE-YI7/asm-spec) | 根 LICENSE: MIT | 改造复用 | 借鉴版本化 manifest、provenance、硬约束、selection/decision receipt 与 evidence digest；重新建模为 AgentManifest/DecisionReceipt。 |
| [ASM hackathon](https://github.com/YE-YI7/asm-arc-circle-2026) | 根 LICENSE: MIT | 改造复用 | 保留角色独立效用、硬门、TOPSIS 思路、Trust Delta 和可解释回执；不压成单一社会总分。 |
| [bisai](https://github.com/Duskriver/bisai) | **未发现根 LICENSE** | 仅参考 | 只参考 candidate gate、组合搜索、局部 repair 和非回归评测的方法；不复制源码或领域对象。 |
| [Qwen3 官方说明](https://qwenlm.github.io/blog/qwen3/) | 官方技术说明 | 仅参考 | 将“qwen3.8”按需求解释为 Qwen3-8B；真实模型 ID 仅来自 `QWEN_MODEL`。 |
| [阿里云百炼 OpenAI-compatible](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) | 官方 API 文档 | 改造复用 | 使用标准 `POST /chat/completions`，不让业务层依赖具体 Qwen SDK。 |

没有整仓复制任何参考项目。

## 仓库状态事实

2026-08-11 首次审计时，当前工作目录不是 Git 仓库；`origin` 可访问但为空。已克隆到独立目录 `CityScope-backend` 并在 `work/backend-agent` 分支开发。没有声称读取不存在的 `contracts/`、`docs/` 或既有代码。

