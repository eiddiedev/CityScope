# CityScope

CityScope 是面向“政企互动 Agent 推演场”赛题的双城竞合因果沙盘。评委不点击预设结局，而是在同一检查点只改变一个原因；成都、重庆、企业、资本与社会主体在权限、资源、信息和承诺约束下自主续演，结果只在终态生成后分类。

场景是“星岚机器人 30 亿元西部研发总部与智能制造基地落地成都高新区 / 重庆两江新区”。产品主界面是可交互双城沙盘，不是多 Agent 群聊。

## 当前可运行版本

- 12 个行为 Agent + 4 个确定性 Service，共 16 个可视化主体；规则与群体计算不伪装成 LLM。
- `Action/PASS → Authority/Privacy/Constraint Gate → World Reducer → StateDelta` 闭环。
- 成都、重庆各自经历部门建议、负责人签发、上级审计；CEO、CFO、董事会独立决策。
- 尽调在第二轮披露非约束性订单事实，随后部门重新建议、城市负责人修订或撤回、协调方提出拆分方案、双方分别表态并重新审计。
- 成都主导、重庆主导、双城协调、两城退出四种终局均由不同正式行动链成立；终局不是 Prompt 参数。
- 终局后计算 12/24 月投资、就业、订单转化、产能利用率、补贴与财政/社会影响，区分“招商赢了”和“政策成功”。
- PolicyPack、资源核算、承诺账本、因果 Trace、Checkpoint 与单因 Fork。
- OR-Tools CP-SAT 先生成满足财政、土地、厂房、能源、人才住房、投资上限和功能依赖的方案；各角色再用独立 TOPSIS 权重排序。
- 决策支持不是独立看板：关键 Agent 的输入、行动理由和 `AgentActionProposed` 因果事件共同引用同一个 `portfolioId / candidateId`。
- 冻结 Contract `v0.1.0` 与经过 Schema/不变量校验的签名 Fixture。
- 3D 双城沙盘、Agent X-Ray、红线门、因果时间线、Fork Lab 与 Eval Arena。
- 现场 Fork API：用户调整一个允许变量，Baseline 与 Intervention 从同一检查点使用相同续演器运行。

完整协作图见 [docs/architecture/cityscope-agent-flow.svg](docs/architecture/cityscope-agent-flow.svg)，路演操作见 [docs/demo/DEMO_RUNBOOK.md](docs/demo/DEMO_RUNBOOK.md)。
第二阶段算法设计与验收见 [docs/architecture/DECISION_SUPPORT.md](docs/architecture/DECISION_SUPPORT.md)。

## 一键运行

```bash
npm install
npm --prefix frontend install
python3 -m venv .venv-optimization
.venv-optimization/bin/python -m pip install -r requirements-optimization.txt
npm run check
npm run dev
```

然后打开 `http://127.0.0.1:5173`。后端默认监听 `http://127.0.0.1:8787`。

`npm run demo` 固定使用确定性 Stub，保证断网下的 3–5 分钟产品演示可重复。配置本地 `.env` 后，`npm start` 和 `npm run demo:live` 使用真实模型；界面与健康检查必须诚实展示当前 provider/model。

## DeepSeek 实时推理

复制 `.env.example` 为本地 `.env` 并填入密钥。`.env` 已被 Git 忽略，密钥不得进入浏览器、Fixture、日志或提交历史。当前默认使用 `deepseek-v4-flash` 非思考模式，以控制完整协作链路的延迟；关键决策升级到 Pro 需要单独评测后再启用。

```bash
npm run demo:live  # 一条真实主世界，不自动展开四个 Fork
npm start          # API 使用 .env 中的 provider
```

2026-08-12 新版真实验收：DeepSeek V4 Flash 冷启动完成 41 步、57 个世界版本，约 70 秒，0 个最终拒绝，自然形成双城协作终局并生成 2 条可执行承诺；热缓存复验约 34 秒。19 个关键行动引用算法候选，覆盖两城、企业、资本、协调、审计和董事会。模型首次结构不合法时只允许一次修复，仍失败才使用经过同一 Gate 的确定性合法方案，拒绝记录不会被删除。

## 模型接口边界

业务层只依赖 `LLMProvider`。密钥只由后端读取，不进入浏览器、Fixture 或日志：

```bash
LLM_PROVIDER=qwen \
QWEN_API_KEY=... \
QWEN_BASE_URL=https://YOUR_ENDPOINT/compatible-mode/v1 \
QWEN_MODEL=YOUR_EXACT_MODEL_ID \
npm run dev
```

Provider 支持 OpenAI-compatible `/chat/completions`、结构化输出、超时、并发限制、Schema修复、Gate反馈修复、缓存与确定性 fallback。DeepSeek 已完成一次真实主世界验收；Qwen 尚未实测，20 次稳定性、P95 延迟和成本统计仍待完成。

实时模型使用两层保守缓存：DeepSeek 自动前缀缓存复用稳定的制度与 Action Schema；CityScope 持久化语义缓存只复用角色、阶段、可见事实、政策、资源、承诺和决策候选完全一致的提案。`runId/worldVersion/trace/receipt` 不参与语义键，命中后重新生成当前运行的 `actionId` 并再次经过 Schema、Authority、Privacy、Constraint Gate。应用不会使用模糊相似度缓存。每轮统计可通过 `GET /api/v0/runs/:runId/usage` 查看。

语义缓存已升级为 `two-round-v3 / semantic_action_cache_v3` 命名空间，旧流程动作不能污染新阶段；结构合法但被 Gate 拒绝的提案会主动失效。2026-08-12 真实链路中 16/41 个行动命中 CityScope 精确缓存；其余模型调用的 DeepSeek 前缀缓存 Token 命中率约 47.4%。完整回归同时验证缓存行动重新盖章、阶段动作白名单、隐私隔离、状态变更强制失效和 Trace 路径一致。

## 关键命令

```bash
npm run demo:fixture       # 重建签名黄金轨迹
npm run fixtures:validate  # Schema + 因果/Fork/终态不变量
npm run eval               # 生成评测报告
npm run eval:sensitivity   # 6变量×9取值×20 seed，共1080次敏感性矩阵
npm run decision:check     # 真实 CP-SAT + TOPSIS + Agent/Trace 集成验收
npm run frontend:test      # 前端契约与交互测试
npm run check              # 后端、契约、Fixture、Eval、前端全回归
```

## 目录

- `backend/`：Agent Manifest、调度器、Gate、Reducer、Provider、Trace 与 API。
- `contracts/v0/`：冻结 Schema 与生成的 TypeScript 类型；前后端共同事实源。
- `fixtures/v0/`：签名黄金轨迹、红线压力测试、Fork 与 Eval 投影。
- `frontend/`：3D 双城沙盘及制度证据界面。
- `evals/`：基线方法和可执行评测。
- `docs/`：架构、验收与路演脚本。
- `proposals/`：冻结前的历史提案；不再是运行时事实源。

## 诚实边界

- 当前 API 是单进程内存存储，适合黑客松 Demo，不是生产级政务系统。
- 当前签名 Fixture 来自确定性 Stub；真实 Qwen 尚未完成 20 次固定种子回放和 P95 延迟统计。
- 单 LLM / 朴素群聊两组 baseline 仍是标注清楚的 evaluator fixture；CityScope 指标来自实际运行。
- 这是反事实机制演示，不是对成都、重庆真实政策和招商结果的预测。

验收事实与未完成项见 [docs/acceptance/INTEGRATION_ACCEPTANCE.md](docs/acceptance/INTEGRATION_ACCEPTANCE.md)。
