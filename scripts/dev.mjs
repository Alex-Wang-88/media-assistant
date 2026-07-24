import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environment = { ...process.env, ...readDotEnv(join(root, ".env")) };
const apiUrl = (environment.YOOM_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const children = new Set();
let stopping = false;

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const sourceLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function apiIsReady() {
  try {
    const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.status === "ok";
  } catch {
    return false;
  }
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: false,
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForApi(apiProcess) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await apiIsReady()) return;
    if (apiProcess?.exitCode !== null) {
      throw new Error(`本地 AI 服务启动失败，退出码：${apiProcess.exitCode}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`本地 AI 服务未能在 10 秒内就绪：${apiUrl}`);
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = exitCode;
}

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));

try {
  let apiProcess = null;
  if (!(await apiIsReady())) {
    apiProcess = start("uv", [
      "run",
      "--directory",
      "apps/api",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
    ]);
  }
  await waitForApi(apiProcess);

  const corepackScript = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  if (!existsSync(corepackScript)) {
    throw new Error(`找不到 Corepack 启动脚本：${corepackScript}`);
  }
  const desktop = start(process.execPath, [
    corepackScript,
    "pnpm",
    "--filter",
    "@yoom/desktop",
    "dev",
  ]);
  desktop.once("exit", (code) => stop(code ?? 0));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
