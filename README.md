# 获客智能助手

桌面端是唯一产品界面，云端 API 负责智能体、计费、交付和远程命令中继。本地
Markdown、图片与报告是内容的唯一主数据。

## 开发

要求 Node 24、pnpm 11、Python 3.13 和 uv。

```powershell
corepack pnpm install
uv sync --project apps/api
pnpm check
pnpm test
pnpm dev
```

API 可单独启动：

```powershell
uv run --directory apps/api uvicorn app.main:app --reload
```

沄荣共享工作流使用服务端环境变量配置，Key 不得进入 Renderer 或提交到仓库：

```powershell
$env:YUNBLOOM_SHARE_URL="https://api.yunbloom.cn/v2/chat/completions/share?shareId=..."
$env:YUNBLOOM_API_KEY="..."
```

共享接口返回 SSE。普通文本会被重组；标准函数调用封装在 `data.content` 的内层
OpenAI completion JSON 中，由适配器提取。函数只提出调用请求，桌面端仍需校验参数、
执行本地工具并回传结果。

首次启动桌面端会让用户选择工作区。创建任务后，本地生成 `project.md`、标准目录和
SQLite 索引。模型与插件目录由参数资料生成，导入方式见
`scripts/import-yunrong-catalog.mjs --help`。
