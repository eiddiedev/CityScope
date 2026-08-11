# HTTP / Event-stream API Proposal

Base path: `/api/v0`。所有失败返回 `{ error: { code, message, details?, retryable } }`。

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/runs` | 从 scenario fixture 创建 run；返回初始 state。 |
| `GET` | `/runs/:runId` | 当前 WorldState 与版本。 |
| `POST` | `/runs/:runId/actions` | 提交 AgentAction 或人类接管动作；返回 receipt、events、deltas。 |
| `GET` | `/runs/:runId/events?afterVersion=N` | 前端消费的顺序事件流。 |
| `POST` | `/runs/:runId/checkpoints` | 创建完整 checkpoint。 |
| `POST` | `/checkpoints/:checkpointId/forks` | 指定一个 intervention 创建 fork。 |
| `POST` | `/runs/:runId/replay` | 使用 snapshot 中模型、Prompt、seed 复放。 |
| `POST` | `/runs/:runId/advance` | 自动推进一轮组织协商/谈判。 |
| `GET` | `/runs/:runId/trace/:causeId` | 沿 causeId 获取动作、条款、事件、上一状态。 |
| `GET` | `/runs/:runId/outcome` | 仅 terminal run 可返回事后分类。 |
| `GET` | `/healthz` | Provider/Demo Mode/缓存状态。 |

并发写入需带 `If-Match: <worldVersion>`；版本不一致返回 `WORLD_VERSION_CONFLICT`。

Round 2 响应定义位于 `contract.schema.json`：`WorldStateResponse`、`ActionResponse`、`EventListResponse`、`CheckpointResponse`、`ForkResponse`、`TraceResponse`、`OutcomeResponse`、`HealthResponse` 和 `ApiError`。`POST /advance` 只运行阶段状态机，不接受完整 action list；Replay action list 仅允许 `/replay` 使用。
