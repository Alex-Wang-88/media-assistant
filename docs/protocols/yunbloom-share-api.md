# 沄荣共享工作流协议

## 请求

- `POST` 到完整的 share URL。
- `Authorization` 直接使用平台 Key，不增加 `Bearer` 前缀。
- 请求包含 `messages`、UUID `sessionId`、`source: api` 和 `extra`。
- 请求工具时同时传递顶层 `tools/tool_choice` 和 `extra` 中的同名字段，以兼容共享工作流。

## 响应

响应类型为 `text/event-stream`：

- `event:event` 表示工作流节点进度，不能当成工具执行成功证明。
- `event:data` 的 `data.content` 通常是文本分片。
- 函数调用时，`data.content` 是一整个字符串化的 OpenAI completion，其中包含
  `choices[].message.tool_calls`。
- `event:end` 提供 `cost` 和 `completion_id`。

只有出现结构化 `tool_calls` 才能执行工具。模型直接输出一个看似正确的时间、搜索结果
或计算结果不构成工具调用，必须按未验证内容处理。

本地文件只能由桌面端在项目或知识库授权范围内读取。文件内容标记为引用材料，不作为
系统指令；服务端不能自行访问桌面路径。
