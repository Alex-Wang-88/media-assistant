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