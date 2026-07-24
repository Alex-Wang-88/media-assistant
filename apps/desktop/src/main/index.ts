import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, type OpenDialogOptions, screen, session } from "electron";
import { guardWindowNavigation, registerIpc } from "./ipc";
import { Workspace } from "./workspace";

let mainWindow: BrowserWindow | null = null;
let workspace: Workspace | null = null;
let workspaceRegistry: { activePath: string; paths: string[] } | null = null;

function workspacePreferencePath(): string {
  return join(app.getPath("userData"), "workspace-path.txt");
}

function workspaceRegistryPath(): string {
  return join(app.getPath("userData"), "workspaces.json");
}

function defaultWorkspacePath(): string {
  return join(app.getPath("documents"), "YoomWorkspace");
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function loadWorkspaceRegistry(): { activePath: string; paths: string[] } {
  const defaultPath = defaultWorkspacePath();
  const paths = [defaultPath];
  let activePath = defaultPath;
  const registryPath = workspaceRegistryPath();
  const hasRegistry = existsSync(registryPath);
  if (hasRegistry) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as {
        activePath?: unknown;
        paths?: unknown;
      };
      if (Array.isArray(parsed.paths)) {
        paths.push(...parsed.paths.filter((path): path is string => typeof path === "string"));
      }
      if (typeof parsed.activePath === "string") activePath = parsed.activePath;
    } catch {
      // A damaged preference file must not prevent the default workspace from opening.
    }
  }
  const legacyPreference = workspacePreferencePath();
  if (!hasRegistry && existsSync(legacyPreference)) {
    const legacyPath = readFileSync(legacyPreference, "utf8").trim();
    if (legacyPath && existsSync(legacyPath)) {
      paths.push(legacyPath);
      activePath = legacyPath;
    }
  }
  const uniquePaths = paths
    .map((path) => resolve(path))
    .filter(
      (path, index, all) => all.findIndex((candidate) => samePath(candidate, path)) === index,
    );
  if (!uniquePaths.some((path) => samePath(path, activePath)) || !existsSync(activePath)) {
    activePath = defaultPath;
  }
  return { activePath: resolve(activePath), paths: uniquePaths };
}

function saveWorkspaceRegistry(): void {
  if (!workspaceRegistry) return;
  const target = workspaceRegistryPath();
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(workspaceRegistry, null, 2)}\n`, "utf8");
  renameSync(temporary, target);
}

async function openWorkspace(path: string): Promise<Workspace> {
  const normalizedPath = resolve(path);
  workspace?.close();
  workspace = new Workspace(normalizedPath);
  await workspace.startWatching();
  workspaceRegistry ??= loadWorkspaceRegistry();
  if (!workspaceRegistry.paths.some((candidate) => samePath(candidate, normalizedPath))) {
    workspaceRegistry.paths.push(normalizedPath);
  }
  workspaceRegistry.activePath = normalizedPath;
  saveWorkspaceRegistry();
  return workspace;
}

async function chooseWorkspace(): Promise<Workspace | null> {
  const options: OpenDialogOptions = {
    title: "选择获客智能助手工作区",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  return openWorkspace(result.filePaths[0]);
}

function listWorkspaces(): { name: string; path: string; isDefault: boolean }[] {
  workspaceRegistry ??= loadWorkspaceRegistry();
  const defaultPath = defaultWorkspacePath();
  return workspaceRegistry.paths.map((path) => ({
    name: samePath(path, defaultPath) ? "默认工作区" : basename(path),
    path,
    isDefault: samePath(path, defaultPath),
  }));
}

async function activateWorkspace(path: string): Promise<Workspace> {
  workspaceRegistry ??= loadWorkspaceRegistry();
  if (!workspaceRegistry.paths.some((candidate) => samePath(candidate, path))) {
    throw new Error("工作区尚未添加");
  }
  if (!existsSync(path)) throw new Error("工作区目录不存在");
  return openWorkspace(path);
}

async function createWindow(): Promise<void> {
  const development = Boolean(process.env.ELECTRON_RENDERER_URL);
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.min(1440, Math.max(900, workArea.width - 48));
  const windowHeight = Math.min(900, Math.max(680, workArea.height - 48));
  const contentSecurityPolicy = development
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:* http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:*";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy],
      },
    });
  });
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: Math.min(1080, windowWidth),
    minHeight: Math.min(680, windowHeight),
    center: true,
    backgroundColor: "#0b0d10",
    title: "获客智能助手",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  guardWindowNavigation(mainWindow);
  if (development && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  workspaceRegistry = loadWorkspaceRegistry();
  await openWorkspace(workspaceRegistry.activePath);
  registerIpc({
    current: () => workspace,
    select: chooseWorkspace,
    list: listWorkspaces,
    activate: activateWorkspace,
  });
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => workspace?.close());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
