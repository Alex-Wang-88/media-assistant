import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishAutomationResult, XAccount } from "@yoom/desktop-contracts";
import { app, BrowserWindow, session } from "electron";
import {
  chooseFileInSystemDialog,
  clickWithSystemMouse,
  replaceTextWithSystemShortcut,
  waitForSystemFileDialog,
} from "./native-input";
import { X_SELECTORS } from "./platforms/x/selectors";

const X_COMPOSE_URL = "https://x.com/compose/post";
const PRIVATE_SESSION_DIRECTORY = "private-platform-sessions";
const X_ACCOUNT_REGISTRY = "accounts.json";

let xWindow: BrowserWindow | null = null;
let activeXAccountId: string | null = null;

type StoredXAccount = Pick<XAccount, "id" | "name"> & {
  userId: string;
  sessionDirectory: string;
};

type XIdentity = {
  userId: string;
  name: string;
};

export async function openAndFillX(
  accountId: string,
  content: string,
  assetPaths: readonly string[],
  autoPublish: boolean,
): Promise<PublishAutomationResult> {
  const window = await openXWindow(accountId);
  return fillXWindow(window, content, assetPaths, autoPublish);
}

export async function continueFillingX(
  accountId: string,
  content: string,
  assetPaths: readonly string[],
  autoPublish: boolean,
): Promise<PublishAutomationResult> {
  const window = await openXWindow(accountId);
  return fillXWindow(window, content, assetPaths, autoPublish);
}

export async function listXAccounts(): Promise<XAccount[]> {
  return loadXAccounts().map(({ id, name }) => ({ id, name }));
}

export async function createXAccount(): Promise<XAccount> {
  const accountId = randomUUID();
  const pendingAccount: StoredXAccount = {
    id: accountId,
    name: "正在登录",
    userId: "",
    sessionDirectory: join("accounts", accountId),
  };
  mkdirSync(resolveXSessionPath(pendingAccount), { recursive: true, mode: 0o700 });
  const window = await openXWindowForAccount(pendingAccount);
  const identity = await waitForXLogin(window);
  if (!identity) {
    await discardPendingXAccount(pendingAccount);
    throw new Error("新账号尚未完成 X 登录，因此没有加入账号列表");
  }

  const accounts = loadXAccounts();
  const existing = accounts.find(
    (account) => account.userId.toLocaleLowerCase() === identity.userId.toLocaleLowerCase(),
  );
  if (existing) {
    await discardPendingXAccount(pendingAccount);
    return { id: existing.id, name: existing.name };
  }

  const account = { ...pendingAccount, name: identity.name, userId: identity.userId };
  saveXAccounts([...accounts, account]);
  return { id: account.id, name: account.name };
}

export async function deleteXAccount(accountId: string): Promise<XAccount[]> {
  const accounts = loadXAccounts();
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("要删除的 X 账号不存在");

  if (xWindow && !xWindow.isDestroyed() && activeXAccountId === account.id) xWindow.destroy();
  await clearXAccountSession(account);
  saveXAccounts(accounts.filter((candidate) => candidate.id !== account.id));
  return listXAccounts();
}

async function openXWindow(accountId: string): Promise<BrowserWindow> {
  const account = requireXAccount(accountId);
  return openXWindowForAccount(account);
}

async function openXWindowForAccount(account: StoredXAccount): Promise<BrowserWindow> {
  const accountChanged = activeXAccountId !== account.id;
  if (accountChanged && xWindow && !xWindow.isDestroyed()) {
    xWindow.destroy();
    xWindow = null;
  }

  if (!xWindow || xWindow.isDestroyed()) {
    const sessionPath = resolveXSessionPath(account);
    mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
    const xSession = session.fromPath(sessionPath);
    const createdWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 650,
      title: "X 发布辅助",
      show: false,
      webPreferences: {
        session: xSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    xWindow = createdWindow;
    createdWindow.on("closed", () => {
      if (xWindow !== createdWindow) return;
      xWindow = null;
      activeXAccountId = null;
    });
    createdWindow.webContents.setWindowOpenHandler(({ url }) => ({
      action: isAllowedXUrl(url) ? "allow" : "deny",
    }));
    createdWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedXUrl(url)) event.preventDefault();
    });
    activeXAccountId = account.id;
  }

  await xWindow.loadURL(X_COMPOSE_URL);
  xWindow.show();
  xWindow.focus();
  return xWindow;
}

function xSessionRoot(): string {
  const root = join(app.getPath("userData"), PRIVATE_SESSION_DIRECTORY, "x");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function xAccountRegistryPath(): string {
  return join(xSessionRoot(), X_ACCOUNT_REGISTRY);
}

function loadXAccounts(): StoredXAccount[] {
  const registryPath = xAccountRegistryPath();
  if (!existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredXAccount) : [];
  } catch {
    return [];
  }
}

function saveXAccounts(accounts: readonly StoredXAccount[]): void {
  const target = xAccountRegistryPath();
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function isStoredXAccount(value: unknown): value is StoredXAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredXAccount>;
  return (
    typeof account.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account.id) &&
    typeof account.name === "string" &&
    account.name.trim().length > 0 &&
    typeof account.userId === "string" &&
    /^@[A-Za-z0-9_]{1,30}$/.test(account.userId) &&
    typeof account.sessionDirectory === "string" &&
    /^accounts[/\\][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      account.sessionDirectory,
    )
  );
}

function requireXAccount(accountId: string): StoredXAccount {
  const account = loadXAccounts().find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("选择的 X 账号不存在，请重新选择");
  return account;
}

function resolveXSessionPath(account: StoredXAccount): string {
  return join(xSessionRoot(), account.sessionDirectory);
}

async function waitForXLogin(window: BrowserWindow): Promise<XIdentity | null> {
  const deadline = Date.now() + 10 * 60 * 1_000;
  while (Date.now() < deadline && !window.isDestroyed()) {
    const identity = await readXIdentity(window);
    if (identity) return identity;
    await delay(1_500);
  }
  return null;
}

async function readXIdentity(window: BrowserWindow): Promise<XIdentity | null> {
  const script = `(() => {
    const account = document.querySelector(${JSON.stringify(X_SELECTORS.accountSwitcher)});
    const profile = document.querySelector(${JSON.stringify(X_SELECTORS.profileLink)});
    const text = account?.innerText || "";
    const handleFromText = text.match(/@[A-Za-z0-9_]{1,30}/)?.[0] || null;
    const href = profile?.getAttribute("href") || "";
    const handleFromHref = /^\\/([A-Za-z0-9_]{1,30})$/.exec(href)?.[1] || null;
    const handle = handleFromText || (handleFromHref ? "@" + handleFromHref : null);
    if (!handle) return null;
    const name = text.split(/\\r?\\n/).map((line) => line.trim()).find(
      (line) => line && !line.startsWith("@")
    ) || handle;
    return { userId: handle, name: name + "（" + handle + "）" };
  })()`;
  try {
    const identity = (await window.webContents.mainFrame.executeJavaScript(
      script,
      true,
    )) as XIdentity | null;
    if (!identity || typeof identity.userId !== "string" || typeof identity.name !== "string") {
      return null;
    }
    return {
      userId: identity.userId,
      name: Array.from(identity.name.trim()).slice(0, 40).join(""),
    };
  } catch {
    return null;
  }
}

async function discardPendingXAccount(account: StoredXAccount): Promise<void> {
  if (xWindow && !xWindow.isDestroyed() && activeXAccountId === account.id) xWindow.destroy();
  await clearXAccountSession(account);
}

async function clearXAccountSession(account: StoredXAccount): Promise<void> {
  const sessionPath = resolveXSessionPath(account);
  try {
    const accountSession = session.fromPath(sessionPath);
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    await accountSession.clearAuthCache();
  } catch {
    // Continue with best-effort removal of the unregistered account directory.
  }
  if (/^accounts[/\\][0-9a-f-]+$/i.test(account.sessionDirectory)) {
    try {
      rmSync(sessionPath, { recursive: true, force: true });
    } catch {
      // Chromium can briefly retain file handles; the account remains unregistered.
    }
  }
}

async function fillXWindow(
  window: BrowserWindow,
  content: string,
  assetPaths: readonly string[],
  autoPublish: boolean,
): Promise<PublishAutomationResult> {
  if (!content.trim()) {
    return { state: "needs_attention", message: "请先填写 X 推文内容。" };
  }
  if (assetPaths.length > 4) {
    return { state: "needs_attention", message: "X 每条帖子最多添加 4 张配图。" };
  }

  const composerReady = await waitForXComposer(window);
  if (!composerReady) {
    const loggedOut = await pageLooksLoggedOut(window);
    return {
      state: loggedOut ? "waiting_for_login" : "needs_attention",
      message: loggedOut
        ? "请在已打开的 X 窗口完成登录，然后返回草稿区继续填充。"
        : "没有识别到 X 发帖输入框，请确认当前位于发帖页面后重试。",
    };
  }

  if (!(await focusXComposer(window))) {
    return { state: "needs_attention", message: "X 发帖输入框暂时不可用，请保留页面后重试。" };
  }
  window.show();
  window.focus();
  await delay(120);
  await replaceTextWithSystemShortcut(content);
  await delay(250);

  if (assetPaths.length > 0 && !(await uploadXImages(window, assetPaths))) {
    return {
      state: "needs_attention",
      message: "推文已填入，但部分配图没有完成上传，请检查 X 发帖窗口后重试。",
    };
  }

  window.show();
  window.focus();
  if (autoPublish) {
    const published = await clickXPost(window);
    if (!published) {
      return {
        state: "needs_attention",
        message: "内容已填入，但没有识别到可点击的“Post”按钮，请检查字数和页面提示。",
      };
    }
    return {
      state: "published",
      message: "推文和配图已填入，并已按自动发布设置点击 X 的“Post”按钮。",
    };
  }

  return {
    state: "filled",
    message: "推文和配图已填入 X 发帖页面，已停在“Post”按钮之前。",
  };
}

async function waitForXComposer(window: BrowserWindow): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await hasVisibleSelector(window, X_SELECTORS.composer)) return true;
    await delay(500);
  }
  return false;
}

async function focusXComposer(window: BrowserWindow): Promise<boolean> {
  const script = `(() => {
    const editor = document.querySelector(${JSON.stringify(X_SELECTORS.composer)});
    if (!editor) return false;
    const rect = editor.getBoundingClientRect();
    const style = getComputedStyle(editor);
    if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    editor.scrollIntoView({ block: "center", inline: "nearest" });
    editor.focus();
    editor.click();
    return document.activeElement === editor || editor.contains(document.activeElement);
  })()`;
  try {
    return Boolean(await window.webContents.mainFrame.executeJavaScript(script, true));
  } catch {
    return false;
  }
}

async function uploadXImages(
  window: BrowserWindow,
  assetPaths: readonly string[],
): Promise<boolean> {
  let uploaded = await readXMediaCount(window);
  for (const path of assetPaths.slice(uploaded)) {
    const opened = await openXFileDialog(window);
    if (!opened || !(await waitForSystemFileDialog(6_000))) return false;
    await chooseFileInSystemDialog(path);
    const nextCount = await waitForXMediaCount(window, uploaded + 1);
    if (nextCount <= uploaded) return false;
    uploaded = nextCount;
  }
  return uploaded >= assetPaths.length;
}

async function openXFileDialog(window: BrowserWindow): Promise<boolean> {
  const script = `(() => {
    const input = document.querySelector(${JSON.stringify(X_SELECTORS.fileInput)});
    if (!input) return false;
    input.click();
    return true;
  })()`;
  try {
    return Boolean(await window.webContents.mainFrame.executeJavaScript(script, true));
  } catch {
    return false;
  }
}

async function readXMediaCount(window: BrowserWindow): Promise<number> {
  const script = `document.querySelectorAll(${JSON.stringify(X_SELECTORS.mediaContainer)}).length`;
  try {
    const count = await window.webContents.mainFrame.executeJavaScript(script, true);
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

async function waitForXMediaCount(window: BrowserWindow, minimum: number): Promise<number> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const count = await readXMediaCount(window);
    if (count >= minimum) return count;
    await delay(500);
  }
  return readXMediaCount(window);
}

async function clickXPost(window: BrowserWindow): Promise<boolean> {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  window.moveTop();
  window.focus();
  await delay(350);
  const script = `(() => {
    const selectors = ${JSON.stringify(X_SELECTORS.postButtons)};
    const buttons = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const button = buttons.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    if (!button) return null;
    button.scrollIntoView({ block: "center", inline: "center" });
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
  try {
    const point = (await window.webContents.mainFrame.executeJavaScript(script, true)) as {
      x: number;
      y: number;
    } | null;
    if (!point) return false;
    const bounds = window.getContentBounds();
    const zoomFactor = window.webContents.getZoomFactor();
    await clickWithSystemMouse(bounds.x + point.x * zoomFactor, bounds.y + point.y * zoomFactor);
    return true;
  } catch {
    return false;
  }
}

async function hasVisibleSelector(window: BrowserWindow, selector: string): Promise<boolean> {
  const script = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  })()`;
  try {
    return Boolean(await window.webContents.mainFrame.executeJavaScript(script, true));
  } catch {
    return false;
  }
}

async function pageLooksLoggedOut(window: BrowserWindow): Promise<boolean> {
  const currentUrl = window.webContents.getURL();
  if (currentUrl.includes("/i/flow/login")) return true;
  const script = `(() => {
    const text = document.body?.innerText || "";
    return ["Sign in", "Log in", "登录", "登入"].some((keyword) => text.includes(keyword));
  })()`;
  try {
    return Boolean(await window.webContents.mainFrame.executeJavaScript(script, true));
  } catch {
    return false;
  }
}

function isAllowedXUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "x.com" ||
        url.hostname.endsWith(".x.com") ||
        url.hostname === "twitter.com" ||
        url.hostname.endsWith(".twitter.com"))
    );
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
