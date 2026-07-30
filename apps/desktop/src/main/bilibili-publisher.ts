import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BilibiliAccount, PublishAutomationResult } from "@yoom/desktop-contracts";
import { app, BrowserWindow, session } from "electron";
import {
  chooseFileInSystemDialog,
  clickWithSystemMouse,
  deleteTextBackwardWithSystemKeyboard,
  replaceTextWithSystemShortcut,
  waitForSystemFileDialog,
} from "./native-input";
import { BILIBILI_SELECTORS } from "./platforms/bilibili/selectors";
import { countConfirmedTrailingPasteCleanupKeystrokes } from "./platforms/bilibili/text";

const BILIBILI_DYNAMIC_URL = "https://t.bilibili.com/";
const PRIVATE_SESSION_DIRECTORY = "private-platform-sessions";
const DEFAULT_BILIBILI_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const BILIBILI_ACCOUNT_REGISTRY = "accounts.json";
const BILIBILI_ACCOUNT_IDENTITY_URL = "https://api.bilibili.com/x/web-interface/nav";

let bilibiliWindow: BrowserWindow | null = null;
let activeBilibiliAccountId: string | null = null;

type StoredBilibiliAccount = Pick<BilibiliAccount, "id" | "name"> & {
  sessionDirectory: string;
};

type ImageFillFailure =
  | "image_button_missing"
  | "add_button_missing"
  | "old_image_remove_failed"
  | "file_dialog_missing"
  | "preview_missing"
  | "upload_timeout";

type ImageFillResult = { ok: true } | { ok: false; reason: ImageFillFailure };

export async function openAndFillBilibili(
  accountId: string,
  title: string,
  content: string,
  assetPaths: readonly string[],
  autoPublish: boolean,
): Promise<PublishAutomationResult> {
  const window = await openBilibiliWindow(accountId);
  return fillBilibiliWindow(window, title, content, assetPaths, autoPublish);
}

export async function continueFillingBilibili(
  accountId: string,
  title: string,
  content: string,
  assetPaths: readonly string[],
  autoPublish: boolean,
): Promise<PublishAutomationResult> {
  const window = await openBilibiliWindow(accountId, false);
  return fillBilibiliWindow(window, title, content, assetPaths, autoPublish);
}

export async function listBilibiliAccounts(): Promise<BilibiliAccount[]> {
  const accounts = loadBilibiliAccounts();
  const refreshed: StoredBilibiliAccount[] = [];
  let changed = false;

  for (const account of accounts) {
    const identity = await readBilibiliIdentity(account);
    const name = identity?.name ?? account.name;
    if (name !== account.name) changed = true;
    refreshed.push({ ...account, name });
  }

  if (changed) saveBilibiliAccounts(refreshed);
  return refreshed.map(({ id, name }) => ({ id, name }));
}

export async function createBilibiliAccount(): Promise<BilibiliAccount> {
  const accountId = randomUUID();
  const pendingAccount: StoredBilibiliAccount = {
    id: accountId,
    name: "正在登录",
    sessionDirectory: join("accounts", accountId),
  };
  mkdirSync(resolveBilibiliSessionPath(pendingAccount), { recursive: true, mode: 0o700 });
  const window = await openBilibiliWindowForAccount(pendingAccount);
  const identity = await waitForBilibiliLogin(window, pendingAccount);
  if (!identity) {
    await discardPendingBilibiliAccount(pendingAccount);
    throw new Error("新账号尚未完成登录，因此没有加入账号列表");
  }

  const accounts = loadBilibiliAccounts();
  for (const account of accounts) {
    const existingIdentity = await readBilibiliIdentity(account);
    if (existingIdentity?.userId === identity.userId) {
      await discardPendingBilibiliAccount(pendingAccount);
      return { id: account.id, name: existingIdentity.name };
    }
  }

  const account = { ...pendingAccount, name: identity.name };
  saveBilibiliAccounts([...accounts, account]);
  return { id: account.id, name: account.name };
}

export async function deleteBilibiliAccount(accountId: string): Promise<BilibiliAccount[]> {
  const accounts = loadBilibiliAccounts();
  if (accounts.length <= 1) throw new Error("至少需要保留一个 B 站账号");
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("要删除的 B 站账号不存在");

  if (bilibiliWindow && !bilibiliWindow.isDestroyed() && activeBilibiliAccountId === account.id) {
    bilibiliWindow.destroy();
  }
  await clearBilibiliAccountSession(account);
  saveBilibiliAccounts(accounts.filter((candidate) => candidate.id !== account.id));
  return listBilibiliAccounts();
}

async function openBilibiliWindow(accountId: string, navigate = true): Promise<BrowserWindow> {
  const account = requireBilibiliAccount(accountId);
  return openBilibiliWindowForAccount(account, navigate);
}

async function openBilibiliWindowForAccount(
  account: StoredBilibiliAccount,
  navigate = true,
): Promise<BrowserWindow> {
  const accountChanged = activeBilibiliAccountId !== account.id;
  if (accountChanged && bilibiliWindow && !bilibiliWindow.isDestroyed()) {
    bilibiliWindow.destroy();
    bilibiliWindow = null;
  }

  if (!bilibiliWindow || bilibiliWindow.isDestroyed()) {
    const sessionPath = resolveBilibiliSessionPath(account);
    mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
    const bilibiliSession = session.fromPath(sessionPath);
    const createdWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 650,
      title: "哔哩哔哩发布辅助",
      show: false,
      webPreferences: {
        session: bilibiliSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    bilibiliWindow = createdWindow;
    createdWindow.on("closed", () => {
      if (bilibiliWindow !== createdWindow) return;
      bilibiliWindow = null;
      activeBilibiliAccountId = null;
    });
    createdWindow.webContents.setWindowOpenHandler(({ url }) => ({
      action: isAllowedBilibiliUrl(url) ? "allow" : "deny",
    }));
    createdWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedBilibiliUrl(url)) event.preventDefault();
    });
    activeBilibiliAccountId = account.id;
    navigate = true;
  }

  if (navigate || !isAllowedBilibiliUrl(bilibiliWindow.webContents.getURL())) {
    await bilibiliWindow.loadURL(BILIBILI_DYNAMIC_URL);
  }
  bilibiliWindow.show();
  bilibiliWindow.focus();
  return bilibiliWindow;
}

function bilibiliSessionRoot(): string {
  const root = join(app.getPath("userData"), PRIVATE_SESSION_DIRECTORY, "bilibili");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function bilibiliAccountRegistryPath(): string {
  return join(bilibiliSessionRoot(), BILIBILI_ACCOUNT_REGISTRY);
}

function loadBilibiliAccounts(): StoredBilibiliAccount[] {
  const registryPath = bilibiliAccountRegistryPath();
  if (existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
      if (Array.isArray(parsed)) {
        const accounts = parsed.filter(isStoredBilibiliAccount);
        if (accounts.length > 0) return accounts;
      }
    } catch {
      // Fall through to the legacy account so damaged metadata never exposes another session.
    }
  }

  const defaultAccount: StoredBilibiliAccount = {
    id: DEFAULT_BILIBILI_ACCOUNT_ID,
    name: "默认账号",
    sessionDirectory: ".",
  };
  saveBilibiliAccounts([defaultAccount]);
  return [defaultAccount];
}

function saveBilibiliAccounts(accounts: readonly StoredBilibiliAccount[]): void {
  const target = bilibiliAccountRegistryPath();
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function isStoredBilibiliAccount(value: unknown): value is StoredBilibiliAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredBilibiliAccount>;
  return (
    typeof account.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account.id) &&
    typeof account.name === "string" &&
    account.name.trim().length > 0 &&
    typeof account.sessionDirectory === "string" &&
    (account.sessionDirectory === "." ||
      /^accounts[/\\][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        account.sessionDirectory,
      ))
  );
}

function requireBilibiliAccount(accountId: string): StoredBilibiliAccount {
  const account = loadBilibiliAccounts().find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("选择的 B 站账号不存在，请重新选择");
  return account;
}

function resolveBilibiliSessionPath(account: StoredBilibiliAccount): string {
  return account.sessionDirectory === "."
    ? bilibiliSessionRoot()
    : join(bilibiliSessionRoot(), account.sessionDirectory);
}

type BilibiliIdentity = {
  userId: string;
  name: string;
};

async function readBilibiliIdentity(
  account: StoredBilibiliAccount,
): Promise<BilibiliIdentity | null> {
  try {
    const accountSession = session.fromPath(resolveBilibiliSessionPath(account));
    const response = await accountSession.fetch(BILIBILI_ACCOUNT_IDENTITY_URL, {
      credentials: "include",
      headers: { Referer: BILIBILI_DYNAMIC_URL },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      code?: unknown;
      data?: { isLogin?: unknown; mid?: unknown; uname?: unknown };
    };
    if (
      payload.code !== 0 ||
      payload.data?.isLogin !== true ||
      !["number", "string"].includes(typeof payload.data.mid) ||
      typeof payload.data.uname !== "string" ||
      !payload.data.uname.trim()
    ) {
      return null;
    }
    const userId = String(payload.data.mid);
    if (!/^\d+$/.test(userId)) return null;
    return {
      userId,
      name: Array.from(payload.data.uname.trim()).slice(0, 40).join(""),
    };
  } catch {
    return null;
  }
}

async function waitForBilibiliLogin(
  window: BrowserWindow,
  account: StoredBilibiliAccount,
): Promise<BilibiliIdentity | null> {
  const deadline = Date.now() + 10 * 60 * 1_000;
  while (Date.now() < deadline && !window.isDestroyed()) {
    const identity = await readBilibiliIdentity(account);
    if (identity) return identity;
    await delay(1_500);
  }
  return null;
}

async function discardPendingBilibiliAccount(account: StoredBilibiliAccount): Promise<void> {
  if (bilibiliWindow && !bilibiliWindow.isDestroyed() && activeBilibiliAccountId === account.id) {
    bilibiliWindow.destroy();
  }
  await clearBilibiliAccountSession(account);
}

async function clearBilibiliAccountSession(account: StoredBilibiliAccount): Promise<void> {
  const sessionPath = resolveBilibiliSessionPath(account);
  try {
    const accountSession = session.fromPath(sessionPath);
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    await accountSession.clearAuthCache();
  } catch {
    // Continue with best-effort removal of the isolated temporary directory.
  }
  if (
    account.sessionDirectory !== "." &&
    /^accounts[/\\][0-9a-f-]+$/i.test(account.sessionDirectory)
  ) {
    try {
      rmSync(sessionPath, { recursive: true, force: true });
    } catch {
      // Chromium can briefly retain file handles on Windows; the folder remains unregistered.
    }
  }
}

async function fillBilibiliWindow(
  window: BrowserWindow,
  title: string,
  content: string,
  assetPaths: readonly string[],
  autoPublish: boolean,
): Promise<PublishAutomationResult> {
  if (!content.trim()) {
    return {
      state: "needs_attention",
      message: "请先填写推文内容并保存草稿。",
    };
  }

  await revealDynamicComposer(window);
  const bodyFocused = await focusBilibiliField(window, "body");
  if (!bodyFocused) {
    const loggedOut = await pageLooksLoggedOut(window);
    return {
      state: loggedOut ? "waiting_for_login" : "needs_attention",
      message: loggedOut
        ? "请在已打开的哔哩哔哩窗口完成首次登录，然后返回发布中心点击“我已登录，继续填充”。"
        : "没有识别到 B 站“发布动态”的正文输入区。请确认当前位于动态首页，再点击“继续填充”。",
    };
  }

  const trimmedTitle = Array.from(title.trim()).slice(0, 20).join("");
  const titleFocused = await focusBilibiliField(window, "title");
  if (!titleFocused && trimmedTitle) {
    return {
      state: "needs_attention",
      message: "已识别到 B 站动态编辑区，但没有识别到标题输入框，请保持发布区域可见后重试。",
    };
  }
  if (titleFocused) {
    await replaceFocusedText(window, trimmedTitle);
  }

  if (!(await focusBilibiliField(window, "body"))) {
    return {
      state: "needs_attention",
      message: "标题已填入，但 B 站动态正文输入区暂时不可用，请保持发布区域可见后重试。",
    };
  }
  await replaceFocusedText(window, content);
  await removeConfirmedBilibiliBodySuffix(window, content);
  if (assetPaths.length > 0) {
    try {
      await chooseImageFiles(window, assetPaths);
    } catch {
      // Image filling is best effort and must not report or block text publishing.
    }
  }

  window.show();
  window.focus();
  if (autoPublish) {
    const published = await clickBilibiliPublish(window);
    if (!published) {
      return {
        state: "needs_attention",
        message:
          "内容已全部填入，但没有识别到可点击的蓝色“发布”按钮，因此没有自动发布。请检查页面后手动发布。",
      };
    }
    return {
      state: "published",
      message: "内容已填入，并已按你的自动发布设置模拟鼠标点击 B 站“发布”按钮。",
    };
  }
  return {
    state: "filled",
    message: "标题、正文和配图已填入 B 站动态发布区，已停在蓝色“发布”按钮之前。",
  };
}

async function revealDynamicComposer(window: BrowserWindow): Promise<void> {
  await focusBilibiliField(window, "body");
}

async function focusBilibiliField(
  window: BrowserWindow,
  field: "title" | "body",
): Promise<boolean> {
  const selector = field === "title" ? BILIBILI_SELECTORS.title : BILIBILI_SELECTORS.body;
  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    const editor = composer?.querySelector(${JSON.stringify(selector)});
    if (!editor) return false;
    const rect = editor.getBoundingClientRect();
    const style = getComputedStyle(editor);
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) return false;
    editor.scrollIntoView({ block: "center", inline: "nearest" });
    editor.focus();
    editor.click();
    return document.activeElement === editor || editor.contains(document.activeElement);
  })()`;
  return executeInFrames(window, script);
}

async function replaceFocusedText(window: BrowserWindow, content: string): Promise<void> {
  window.show();
  window.focus();
  await delay(120);
  await replaceTextWithSystemShortcut(content);
  await delay(120);
}

async function removeConfirmedBilibiliBodySuffix(
  window: BrowserWindow,
  expected: string,
): Promise<void> {
  const actual = await readBilibiliBodyText(window);
  if (actual === null) return;
  const cleanupKeystrokeCount = countConfirmedTrailingPasteCleanupKeystrokes(actual, expected);
  if (cleanupKeystrokeCount === 0) return;
  if (!(await placeBilibiliBodyCaretAtEnd(window))) return;

  window.show();
  window.focus();
  await delay(80);
  try {
    await deleteTextBackwardWithSystemKeyboard(cleanupKeystrokeCount);
  } catch {
    // Trailing cleanup is best effort and must never block image filling or publishing.
  }
}

async function readBilibiliBodyText(window: BrowserWindow): Promise<string | null> {
  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    const editor = composer?.querySelector(${JSON.stringify(BILIBILI_SELECTORS.body)});
    return editor?.textContent ?? null;
  })()`;
  const root = window.webContents.mainFrame;
  const frames = [root, ...root.framesInSubtree].filter(
    (frame, index, all) =>
      all.findIndex((candidate) => candidate.routingId === frame.routingId) === index,
  );
  for (const frame of frames) {
    try {
      const text = (await frame.executeJavaScript(script, true)) as unknown;
      if (typeof text === "string") return text;
    } catch {
      // Cross-origin or transient frames can disappear while the page is loading.
    }
  }
  return null;
}

async function placeBilibiliBodyCaretAtEnd(window: BrowserWindow): Promise<boolean> {
  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    const editor = composer?.querySelector(${JSON.stringify(BILIBILI_SELECTORS.body)});
    if (!editor) return false;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  })()`;
  return executeInFrames(window, script);
}

async function chooseImageFiles(
  window: BrowserWindow,
  assetPaths: readonly string[],
): Promise<ImageFillResult> {
  const path = assetPaths[0];
  if (!path) return { ok: true };

  const existingState = await readBilibiliImageState(window);
  if (existingState.total > 0 && !(await removeExistingBilibiliImages(window))) {
    return { ok: false, reason: "old_image_remove_failed" };
  }

  const previousState = await readBilibiliImageState(window);
  const addButtonVisible = await isBilibiliSelectorVisible(
    window,
    BILIBILI_SELECTORS.addImageButton,
  );
  const control = addButtonVisible ? "add" : "initial";
  const triggered = await clickBilibiliImageControl(window, control);
  if (!triggered) {
    return {
      ok: false,
      reason: control === "add" ? "add_button_missing" : "image_button_missing",
    };
  }

  const dialogOpen = await waitForSystemFileDialog(6_000);
  if (!dialogOpen) return { ok: false, reason: "file_dialog_missing" };

  await chooseFileInSystemDialog(path);
  const uploadState = await waitForBilibiliImageUpload(window, previousState);
  if (uploadState !== "completed") return { ok: false, reason: uploadState };

  return { ok: true };
}

async function clickBilibiliImageControl(
  window: BrowserWindow,
  control: "initial" | "add",
): Promise<boolean> {
  const selector =
    control === "initial"
      ? BILIBILI_SELECTORS.initialImageButton
      : BILIBILI_SELECTORS.addImageButton;
  return clickBilibiliPageControl(window, selector);
}

async function clickBilibiliPageControl(window: BrowserWindow, selector: string): Promise<boolean> {
  window.show();
  window.focus();
  await delay(200);

  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    const element = composer?.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const updatedRect = element.getBoundingClientRect();
    return {
      x: Math.round(updatedRect.left + updatedRect.width / 2),
      y: Math.round(updatedRect.top + updatedRect.height / 2)
    };
  })()`;

  try {
    const point = (await window.webContents.mainFrame.executeJavaScript(script, true)) as {
      x: number;
      y: number;
    } | null;
    if (!point) return false;

    window.webContents.sendInputEvent({
      type: "mouseMove",
      x: point.x,
      y: point.y,
    });
    window.webContents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      x: point.x,
      y: point.y,
    });
    await delay(60);
    window.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: point.x,
      y: point.y,
    });
    return true;
  } catch {
    return false;
  }
}

async function removeExistingBilibiliImages(window: BrowserWindow): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await readBilibiliImageState(window);
    if (before.total === 0) return true;

    const clicked = await clickBilibiliPageControl(window, BILIBILI_SELECTORS.removeImageButton);
    if (!clicked) return false;

    let removed = false;
    for (let check = 0; check < 20; check += 1) {
      await delay(100);
      const current = await readBilibiliImageState(window);
      if (current.total < before.total) {
        removed = true;
        break;
      }
    }
    if (!removed) return false;
  }

  return (await readBilibiliImageState(window)).total === 0;
}

async function readBilibiliImageState(
  window: BrowserWindow,
): Promise<{ total: number; completed: number }> {
  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    if (!composer) return { total: 0, completed: 0 };
    return {
      total: composer.querySelectorAll(${JSON.stringify(BILIBILI_SELECTORS.imageItem)}).length,
      completed: composer.querySelectorAll(
        ${JSON.stringify(BILIBILI_SELECTORS.completedImageItem)}
      ).length
    };
  })()`;
  try {
    const state = (await window.webContents.mainFrame.executeJavaScript(script, true)) as {
      total: number;
      completed: number;
    };
    return {
      total: Number(state.total) || 0,
      completed: Number(state.completed) || 0,
    };
  } catch {
    return { total: 0, completed: 0 };
  }
}

async function waitForBilibiliImageUpload(
  window: BrowserWindow,
  previousState: { total: number; completed: number },
): Promise<"completed" | "preview_missing" | "upload_timeout"> {
  let itemAppeared = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(500);
    const state = await readBilibiliImageState(window);
    if (state.total > previousState.total) itemAppeared = true;
    if (state.completed > previousState.completed) return "completed";
  }
  return itemAppeared ? "upload_timeout" : "preview_missing";
}

async function clickBilibiliPublish(window: BrowserWindow): Promise<boolean> {
  return clickBilibiliControl(window, BILIBILI_SELECTORS.publishButton);
}

async function isBilibiliSelectorVisible(
  window: BrowserWindow,
  selector: string,
): Promise<boolean> {
  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    const element = composer?.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  })()`;
  try {
    return Boolean(await window.webContents.mainFrame.executeJavaScript(script, true));
  } catch {
    return false;
  }
}

async function clickBilibiliControl(window: BrowserWindow, selector: string): Promise<boolean> {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  window.moveTop();
  window.focus();
  await delay(350);

  const script = `(() => {
    const composer = document.querySelector(${JSON.stringify(BILIBILI_SELECTORS.composer)});
    const element = composer?.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const updatedRect = element.getBoundingClientRect();
    return {
      x: updatedRect.left + updatedRect.width / 2,
      y: updatedRect.top + updatedRect.height / 2
    };
  })()`;
  try {
    const point = (await window.webContents.mainFrame.executeJavaScript(script, true)) as {
      x: number;
      y: number;
    } | null;
    if (!point) return false;
    const contentBounds = window.getContentBounds();
    const zoomFactor = window.webContents.getZoomFactor();
    await clickWithSystemMouse(
      contentBounds.x + point.x * zoomFactor,
      contentBounds.y + point.y * zoomFactor,
    );
    return true;
  } catch {
    return false;
  }
}

async function pageLooksLoggedOut(window: BrowserWindow): Promise<boolean> {
  const script = `(() => {
    const text = document.body?.innerText || "";
    return ["立即登录", "扫码登录", "密码登录", "登录后"].some((keyword) => text.includes(keyword));
  })()`;
  return executeInFrames(window, script);
}

async function executeInFrames(window: BrowserWindow, script: string): Promise<boolean> {
  const root = window.webContents.mainFrame;
  const frames = [root, ...root.framesInSubtree].filter(
    (frame, index, all) =>
      all.findIndex((candidate) => candidate.routingId === frame.routingId) === index,
  );
  for (const frame of frames) {
    try {
      if (await frame.executeJavaScript(script, true)) return true;
    } catch {
      // Cross-origin or transient frames can disappear while the page is loading.
    }
  }
  return false;
}

function isAllowedBilibiliUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com"))
    );
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
