# Contract v0 Review Request

## 请求决定

请产品/验收负责人逐项回复 `APPROVE`、`CHANGES_REQUESTED` 或备注：

- [ ] AgentAction 枚举、禁用字段和 actor 权限边界。
- [ ] WorldState 指标、城市/企业/事实/承诺账本结构。
- [ ] 事件 envelope、事件名与 causeId 追踪规则。
- [ ] `/api/v0` 路径、乐观锁和事件流消费方式。
- [ ] 错误码、HTTP 状态与 retryable 语义。
- [ ] Checkpoint/Fork 单原因干预与 snapshot 完整性。

## 冻结条件

只有验收/产品负责人明确批准后，才可把本目录内容提升到 `contracts/`。当前后端实现是提案验证器，并不把它声称为冻结单一事实源。

## 已知待确认项

1. 前端事件流首版采用轮询还是 SSE。
2. 金额单位统一使用 `millionCny` 是否可接受。
3. Outcome 标签是否允许多标签，当前建议“主标签 + evidence”，不含 winner。
4. 人类接管动作是否必须携带操作者审计身份。

