import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  accessSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { app } from "electron";

const API_START_TIMEOUT_MS = 20_000;
const API_POLL_INTERVAL_MS = 250;

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const values: Record<string, string> = {};

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

function prepareApplicationDirectories(): {
  root: string;
  config: string;
  logs: string;
} {
  const root = app.getPath("userData");

  const directories = {
    root,
    runtime: join(root, "runtime"),
    config: join(root, "config"),
    data: join(root, "data"),
    sessions: join(root, "sessions"),
    logs: join(root, "logs"),
  };

  for (const path of Object.values(directories)) {
    mkdirSync(path, { recursive: true });
  }

  return {
    root: directories.root,
    config: directories.config,
    logs: directories.logs,
  };
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();

    server.unref();
    server.once("error", rejectPort);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("无法分配本地 API 端口"));
        return;
      }

      const port = address.port;

      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }

        resolvePort(port);
      });
    });
  });
}

async function waitForApi(
  apiUrl: string,
  process: ChildProcess,
  launchError: () => Error | null,
): Promise<void> {
  const deadline = Date.now() + API_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const processError = launchError();

    if (processError) {
      throw processError;
    }

    if (process.exitCode !== null) {
      throw new Error(`本地 API 已退出，退出码：${process.exitCode}`);
    }

    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });

      if (response.ok) return;
    } catch {
      // 服务仍在启动，继续等待。
    }

    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, API_POLL_INTERVAL_MS);
    });
  }

  throw new Error(`本地 API 未能在 ${API_START_TIMEOUT_MS / 1_000} 秒内启动`);
}

export async function startLocalApi(): Promise<() => void> {
  const directories = prepareApplicationDirectories();

  if (!app.isPackaged) {
    return () => undefined;
  }

  if (process.arch !== "arm64") {
    throw new Error(`当前安装包只支持 Apple Silicon，检测到架构：${process.arch}`);
  }

  const executable = join(process.resourcesPath, "api", "yoom-api");

  if (!existsSync(executable)) {
    throw new Error(`缺少内置 API 服务：${executable}`);
  }

  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(`内置 API 服务没有执行权限：${executable}`);
  }

  const port = await findAvailablePort();
  const apiUrl = `http://127.0.0.1:${port}`;
  const configPath = join(directories.config, ".env");
  const applicationEnvironment = readDotEnv(configPath);
  const logPath = join(directories.logs, "api.log");
  const logFile = openSync(logPath, "a");

  let apiProcess: ChildProcess;
  let processLaunchError: Error | null = null;

  try {
    apiProcess = spawn(executable, [], {
      env: {
        ...process.env,
        ...applicationEnvironment,
        YOOM_API_PORT: String(port),
        YOOM_API_URL: apiUrl,
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["ignore", logFile, logFile],
    });
  } finally {
    closeSync(logFile);
  }

  apiProcess.once("error", (error) => {
    processLaunchError = error;
  });

  process.env.YOOM_API_URL = apiUrl;

  try {
    await waitForApi(apiUrl, apiProcess, () => processLaunchError);
  } catch (error) {
    if (apiProcess.exitCode === null) {
      apiProcess.kill("SIGTERM");
    }

    throw error;
  }

  return () => {
    if (apiProcess.exitCode === null && !apiProcess.killed) {
      apiProcess.kill("SIGTERM");
    }
  };
}