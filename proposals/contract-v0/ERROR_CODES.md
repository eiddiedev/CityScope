# Error Code Proposal

| code | HTTP | retryable | 含义 |
|---|---:|---:|---|
| `INVALID_ACTION_SCHEMA` | 400 | false | AgentAction 未通过结构校验或含禁用字段。 |
| `AUTHORITY_DENIED` | 403 | false | 角色无权执行动作。 |
| `PRIVATE_FACT_FORBIDDEN` | 403 | false | observation 或动作引用未披露事实。 |
| `CONSTRAINT_VIOLATION` | 422 | false | 预算、资源、政策红线或依赖不满足。 |
| `WORLD_VERSION_CONFLICT` | 409 | true | 乐观锁版本过期。 |
| `RUN_NOT_FOUND` | 404 | false | run 不存在。 |
| `CHECKPOINT_NOT_FOUND` | 404 | false | checkpoint 不存在。 |
| `INVALID_FORK_INTERVENTION` | 422 | false | Fork 同时改变零个或多个原因。 |
| `RUN_NOT_TERMINAL` | 409 | false | 终止前请求 outcome。 |
| `PROVIDER_TIMEOUT` | 504 | true | 模型超时，服务端会尝试 fallback。 |
| `PROVIDER_INVALID_OUTPUT` | 502 | true | 修复一次后仍不匹配 Schema。 |
| `REPLAY_DIVERGED` | 409 | false | 固定快照回放产生不同 digest。 |
| `NOT_FOUND` | 404 | false | API 路径不存在。 |
| `INTERNAL_ERROR` | 500 | false | 未分类的服务端错误；不得暴露密钥或私有 observation。 |
| `AUTONOMOUS_ACTION_LIST_FORBIDDEN` | 400 | false | Autonomous Mode 不接受预写动作序列。 |
| `RESOURCE_EXCEEDED` | 422 | false | 财政、土地/厂房、能源或人才住房可用量不足。 |
| `RESOURCE_RESERVATION_MISSING` | 409 | false | 接受政策时找不到对应 reserved 资源。 |
| `RESOURCE_RELEASE_EXCEEDS_STATE` | 409 | false | 释放量超过 reserved/committed 状态。 |
