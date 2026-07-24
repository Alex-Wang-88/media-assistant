# 获客智能助手

桌面端是唯一产品界面，云端 API 负责智能体、计费、交付和远程命令中继。本地
Markdown、图片与报告是内容的唯一主数据。

## 开发

要求 Node 24、pnpm 11、Python 3.13 和 uv。

### Windows 环境安装与启动

```powershell
corepack pnpm install
uv sync --project apps/api
pnpm check
pnpm test
pnpm dev
```

### macOS 环境安装

以下命令在项目根目录执行。依赖、虚拟环境和构建产物会写入 Git 已忽略的目录，
不会修改源码或 Git 跟踪配置。

```bash
set -e

mkdir -p "$HOME/.local/bin"
corepack enable --install-directory "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"

corepack install
CI=true pnpm install --frozen-lockfile --ignore-scripts
apps/desktop/node_modules/.bin/install-electron --no

uv python install 3.13
uv sync --project apps/api --python 3.13 --frozen

apps/api/.venv/bin/python --version
apps/desktop/node_modules/.bin/electron-vite --version
test -f apps/desktop/node_modules/electron/path.txt
```

### macOS 启动

环境安装完成后，在项目根目录执行：

```bash
set -e

test -x apps/api/.venv/bin/python
test -x apps/desktop/node_modules/.bin/electron-vite
test -f apps/desktop/node_modules/electron/path.txt

PYTHONDONTWRITEBYTECODE=1 \
uv run --no-sync --directory apps/api \
  uvicorn app.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

until curl -fsS http://127.0.0.1:8000/health >/dev/null; do
  kill -0 "$API_PID" 2>/dev/null || {
    echo "API 启动失败"
    exit 1
  }
  sleep 0.25
done

cd apps/desktop
node_modules/.bin/electron-vite dev
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
