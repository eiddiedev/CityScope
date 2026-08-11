# Prompt Versions

Prompt 只负责让 Agent 基于可见观察提出一个候选 `AgentAction`。它不能执行工具、修改 WorldState、代表其他组织承诺或指定结局。

- `cityscope-agent.v1`：通用结构化动作边界。
- `chengdu.v1`：研发总部、人才和财政兑现权重。
- `chongqing.v1`：制造产值、工厂、供应链和能源权重。
- `company.v1`：CEO/CFO/董事会的内部冲突与正式回应权限。

真实运行会把具体 AgentManifest、私有 observation 和 action schema 注入系统消息；Prompt/模型版本连同 seed 固化进 checkpoint。

