# 系统边界

```text
Electron Renderer
  -> validated preload commands
  -> Electron main (workspace files, SQLite, workers, publishing)
  -> FastAPI (agent, billing, delivery queue, remote command relay)
  -> provider adapters
  -> independent platform APIs
```

本地内容不会由服务器直接写入。云端生成结果先进入交付队列；客户端原子写入、计算
SHA256 并发送 `artifact.committed` 后，云端才可把交付标记为完成。
