# CityScope Contract v0 Proposal

状态：`PROPOSED`，不是冻结契约。

本目录提出前后端可评审的 Schema、事件、API 和错误码。批准前：

1. 不创建 `contracts/`。
2. 后端内部实现可以验证提案，但不得宣称它是单一事实源。
3. 字段或事件变化直接在本提案讨论；冻结后任何变化必须走 `CHANGE_REQUEST.md`。

版本策略：`schemaVersion=cityscope.contract.v0`；事件均带 `eventId`、`causeId`、`worldVersion` 和时间戳；未知字段默认拒绝。

