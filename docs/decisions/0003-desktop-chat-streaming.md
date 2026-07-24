# ADR 0003：桌面聊天通过类型化事件流连接智能体 API

状态：已接受

Electron Renderer 不直接访问网络或 Node API。聊天请求由 preload 的类型化命令发送到
Electron main，再由 main 中的 API adapter 调用 FastAPI `/v1/chat/stream`。FastAPI 只输出
经过 schema 验证的 `start`、`text-delta`、`tool-call`、`finish` 和 `error` 事件。

Renderer 只消费事件并更新 UI；第三方 SSE 的字段差异由 provider adapter 处理。服务端
不会读取或覆盖本地工作区文件，工具调用只有在收到结构化 `tool-call` 时才会显示或进入
后续执行流程。

开发启动器同时启动 FastAPI 和 Electron。API 不可用、未配置或流中断时必须产生明确的
可恢复错误，输入内容保留供用户重试。
