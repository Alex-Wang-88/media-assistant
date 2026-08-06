import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishAutomationResult, ZhihuAccount } from "@yoom/desktop-contracts";
import { app, BrowserWindow, session } from "electron";
import {
  appendTextWithSystemShortcut,
  chooseFileInSystemDialog,
  replaceTextWithSystemShortcut,
  waitForSystemFileDialog,
} from "./native-input";
import { ZHIHU_SELECTORS } from "./platforms/zhihu/selectors";

const ZHIHU_WRITE_URL = "https://zhuanlan.zhihu.com/write";
const ZHIHU_IDENTITY_URL = "https://www.zhihu.com/api/v4/me";
const PRIVATE_SESSION_DIRECTORY = "private-platform-sessions";
const ZHIHU_ACCOUNT_REGISTRY = "accounts.json";

let zhihuWindow: BrowserWindow | null = null;
let activeZhihuAccountId: string | null = null;

type StoredZhihuAccount = Pick<ZhihuAccount, "id" | "name"> & {
  sessionDirectory: string;
};

type ZhihuIdentity = {
  userId: string;
  name: string;
};

export type ZhihuPublishBlock =
  | { type: "text"; content: string }
  | { type: "image"; path: string; caption: string };

export async function openAndFillZhihu(
  accountId: string,
  title: string,
  blocks: readonly ZhihuPublishBlock[],
): Promise<PublishAutomationResult> {
  const window = await openZhihuWindow(accountId);
  return fillZhihuWindow(window, title, blocks);
}

export async function continueFillingZhihu(
  accountId: string,
  title: string,
  blocks: readonly ZhihuPublishBlock[],
): Promise<PublishAutomationResult> {
  const window = await openZhihuWindow(accountId, false);
  return fillZhihuWindow(window, title, blocks);
}

export async function listZhihuAccounts(): Promise<ZhihuAccount[]> {
  const accounts = loadZhihuAccounts();
  const refreshed: StoredZhihuAccount[] = [];
  let changed = false;

  for (const account of accounts) {
    const identity = await readZhihuIdentity(account);
    const name = identity?.name ?? account.name;
    if (name !== account.name) changed = true;
    refreshed.push({ ...account, name });
  }

  if (changed) saveZhihuAccounts(refreshed);
  return refreshed.map(({ id, name }) => ({ id, name }));
}

export async function createZhihuAccount(): Promise<ZhihuAccount> {
  const accountId = randomUUID();
  const pendingAccount: StoredZhihuAccount = {
    id: accountId,
    name: "正在登录",
    sessionDirectory: join("accounts", accountId),
  };
  mkdirSync(resolveZhihuSessionPath(pendingAccount), { recursive: true, mode: 0o700 });
  const window = await openZhihuWindowForAccount(pendingAccount);
  const identity = await waitForZhihuLogin(window, pendingAccount);
  if (!identity) {
    await discardPendingZhihuAccount(pendingAccount);
    throw new Error("新账号尚未完成知乎登录，因此没有加入账号列表");
  }

  const accounts = loadZhihuAccounts();
  for (const account of accounts) {
    const existingIdentity = await readZhihuIdentity(account);
    if (existingIdentity?.userId === identity.userId) {
      await discardPendingZhihuAccount(pendingAccount);
      return { id: account.id, name: existingIdentity.name };
    }
  }

  const account = { ...pendingAccount, name: identity.name };
  saveZhihuAccounts([...accounts, account]);
  return { id: account.id, name: account.name };
}

export async function deleteZhihuAccount(accountId: string): Promise<ZhihuAccount[]> {
  const accounts = loadZhihuAccounts();
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("要删除的知乎账号不存在");

  if (zhihuWindow && !zhihuWindow.isDestroyed() && activeZhihuAccountId === account.id) {
    zhihuWindow.destroy();
  }
  await clearZhihuAccountSession(account);
  saveZhihuAccounts(accounts.filter((candidate) => candidate.id !== account.id));
  return listZhihuAccounts();
}

async function openZhihuWindow(accountId: string, navigate = true): Promise<BrowserWindow> {
  const account = requireZhihuAccount(accountId);
  return openZhihuWindowForAccount(account, navigate);
}

async function openZhihuWindowForAccount(
  account: StoredZhihuAccount,
  navigate = true,
): Promise<BrowserWindow> {
  const accountChanged = activeZhihuAccountId !== account.id;
  if (accountChanged && zhihuWindow && !zhihuWindow.isDestroyed()) {
    zhihuWindow.destroy();
    zhihuWindow = null;
  }

  if (!zhihuWindow || zhihuWindow.isDestroyed()) {
    const sessionPath = resolveZhihuSessionPath(account);
    mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
    const zhihuSession = session.fromPath(sessionPath);
    const createdWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 650,
      title: "知乎发布辅助",
      show: false,
      webPreferences: {
        session: zhihuSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    zhihuWindow = createdWindow;
    createdWindow.on("closed", () => {
      if (zhihuWindow !== createdWindow) return;
      zhihuWindow = null;
      activeZhihuAccountId = null;
    });
    createdWindow.webContents.setWindowOpenHandler(({ url }) => ({
      action: isAllowedZhihuUrl(url) ? "allow" : "deny",
    }));
    createdWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedZhihuUrl(url)) event.preventDefault();
    });
    activeZhihuAccountId = account.id;
    navigate = true;
  }

  if (navigate || !isAllowedZhihuUrl(zhihuWindow.webContents.getURL())) {
    await zhihuWindow.loadURL(ZHIHU_WRITE_URL);
  }
  zhihuWindow.show();
  zhihuWindow.focus();
  return zhihuWindow;
}

function zhihuSessionRoot(): string {
  const root = join(app.getPath("userData"), PRIVATE_SESSION_DIRECTORY, "zhihu");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function zhihuAccountRegistryPath(): string {
  return join(zhihuSessionRoot(), ZHIHU_ACCOUNT_REGISTRY);
}

function loadZhihuAccounts(): StoredZhihuAccount[] {
  const registryPath = zhihuAccountRegistryPath();
  if (existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
      if (Array.isArray(parsed)) {
        const accounts = parsed.filter(isStoredZhihuAccount);
        if (accounts.length > 0) return accounts;
      }
    } catch {
      // Damaged account metadata falls back to the isolated default session.
    }
  }

  return [];
}

function saveZhihuAccounts(accounts: readonly StoredZhihuAccount[]): void {
  const target = zhihuAccountRegistryPath();
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function isStoredZhihuAccount(value: unknown): value is StoredZhihuAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredZhihuAccount>;
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

function requireZhihuAccount(accountId: string): StoredZhihuAccount {
  const account = loadZhihuAccounts().find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("选择的知乎账号不存在，请重新选择");
  return account;
}

function resolveZhihuSessionPath(account: StoredZhihuAccount): string {
  return account.sessionDirectory === "."
    ? zhihuSessionRoot()
    : join(zhihuSessionRoot(), account.sessionDirectory);
}

async function readZhihuIdentity(account: StoredZhihuAccount): Promise<ZhihuIdentity | null> {
  try {
    const accountSession = session.fromPath(resolveZhihuSessionPath(account));
    const response = await accountSession.fetch(ZHIHU_IDENTITY_URL, {
      credentials: "include",
      headers: { Referer: "https://www.zhihu.com/" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      id?: unknown;
      name?: unknown;
      url_token?: unknown;
    };
    const userId =
      typeof payload.id === "string" && payload.id.trim()
        ? payload.id.trim()
        : typeof payload.url_token === "string" && payload.url_token.trim()
          ? payload.url_token.trim()
          : null;
    if (!userId || typeof payload.name !== "string" || !payload.name.trim()) return null;
    return {
      userId,
      name: Array.from(payload.name.trim()).slice(0, 40).join(""),
    };
  } catch {
    return null;
  }
}

async function waitForZhihuLogin(
  window: BrowserWindow,
  account: StoredZhihuAccount,
): Promise<ZhihuIdentity | null> {
  const deadline = Date.now() + 10 * 60 * 1_000;
  while (Date.now() < deadline && !window.isDestroyed()) {
    const identity = await readZhihuIdentity(account);
    if (identity) return identity;
    await delay(1_500);
  }
  return null;
}

async function discardPendingZhihuAccount(account: StoredZhihuAccount): Promise<void> {
  if (zhihuWindow && !zhihuWindow.isDestroyed() && activeZhihuAccountId === account.id) {
    zhihuWindow.destroy();
  }
  await clearZhihuAccountSession(account);
}

async function clearZhihuAccountSession(account: StoredZhihuAccount): Promise<void> {
  const sessionPath = resolveZhihuSessionPath(account);
  try {
    const accountSession = session.fromPath(sessionPath);
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    await accountSession.clearAuthCache();
  } catch {
    // Continue with best-effort removal of the isolated account directory.
  }
  if (
    account.sessionDirectory !== "." &&
    /^accounts[/\\][0-9a-f-]+$/i.test(account.sessionDirectory)
  ) {
    try {
      rmSync(sessionPath, { recursive: true, force: true });
    } catch {
      // Chromium can briefly retain file handles on Windows; the account stays unregistered.
    }
  }
}

async function fillZhihuWindow(
  window: BrowserWindow,
  title: string,
  blocks: readonly ZhihuPublishBlock[],
): Promise<PublishAutomationResult> {
  const hasContent = blocks.some(
    (block) => block.type === "image" || (block.type === "text" && block.content.trim()),
  );
  if (!title.trim() || !hasContent) {
    return {
      state: "needs_attention",
      message: "知乎文章需要同时填写标题和正文。",
    };
  }

  await waitForPageReady(window);
  if (!(await focusZhihuField(window, "title"))) {
    return {
      state: (await pageLooksLoggedOut(window)) ? "waiting_for_login" : "needs_attention",
      message: (await pageLooksLoggedOut(window))
        ? "请在已打开的知乎窗口完成登录，然后返回发布中心继续填充。"
        : "没有识别到知乎文章标题输入框，请确认当前位于“写文章”页面后重试。",
    };
  }
  await replaceFocusedText(window, Array.from(title.trim()).slice(0, 80).join(""));

  if (!(await focusZhihuField(window, "body"))) {
    return {
      state: "needs_attention",
      message: "标题已填入，但没有识别到知乎文章正文编辑区。",
    };
  }
  await replaceFocusedText(window, "");

  let insertedContent = false;
  for (const block of blocks) {
    if (block.type === "text") {
      if (!block.content.trim()) continue;
      if (!(await placeZhihuBodyCaretAtEnd(window))) {
        return { state: "needs_attention", message: "无法继续定位知乎正文末尾。" };
      }
      await appendFocusedText(window, `${insertedContent ? "\n\n" : ""}${block.content}`);
      insertedContent = true;
      continue;
    }
    if (!(await insertZhihuImage(window, block.path, block.caption))) {
      return {
        state: "needs_attention",
        message:
          "标题和前序内容已填入；有一张配图没有完成上传或插入，请保留知乎窗口并检查插图区域。",
      };
    }
    insertedContent = true;
  }

  window.show();
  window.focus();
  return {
    state: "filled",
    message: "标题、段落和配图已按草稿顺序填入知乎文章编辑器，已停在发布操作之前。",
  };
}

async function focusZhihuField(window: BrowserWindow, field: "title" | "body"): Promise<boolean> {
  const selectors = field === "title" ? ZHIHU_SELECTORS.title : ZHIHU_SELECTORS.body;
  const script = `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.focus();
    element.click();
    return document.activeElement === element || element.contains(document.activeElement);
  })()`;
  return executeInFrames(window, script);
}

async function replaceFocusedText(window: BrowserWindow, content: string): Promise<void> {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  window.moveTop();
  window.focus();
  await delay(150);
  await replaceTextWithSystemShortcut(content);
  await delay(200);
}

async function appendFocusedText(window: BrowserWindow, content: string): Promise<void> {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  window.moveTop();
  window.focus();
  await delay(150);
  await appendTextWithSystemShortcut(content);
  await delay(200);
}

async function insertZhihuImage(
  window: BrowserWindow,
  path: string,
  caption: string,
): Promise<boolean> {
  if (!(await placeZhihuBodyCaretAtEnd(window))) return false;
  const previousCount = await countZhihuBodyImages(window);
  const clicked = await clickZhihuImageControl(window);
  if (!clicked) return false;

  if (!(await clickZhihuLocalImageUpload(window))) return false;
  if (!(await waitForSystemFileDialog(6_000))) return false;
  await chooseFileInSystemDialog(path);
  if (!(await waitForAndClickZhihuSingleImage(window))) return false;
  if (!(await waitForZhihuImageDialogToClose(window))) return false;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(500);
    if ((await countZhihuBodyImages(window)) >= previousCount + 1) {
      if (caption.trim()) {
        await fillLatestZhihuImageCaption(
          window,
          Array.from(caption.trim()).slice(0, 140).join(""),
        );
      }
      return true;
    }
  }
  return false;
}

async function fillLatestZhihuImageCaption(window: BrowserWindow, caption: string): Promise<void> {
  const selectors = ZHIHU_SELECTORS.body;
  const findPointScript = `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const editor = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!editor) return null;
    const captions = Array.from(editor.querySelectorAll("figure[data-block='true'] figcaption.Image-captionV2"))
      .filter((caption) => {
        const rect = caption.getBoundingClientRect();
        const style = getComputedStyle(caption);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden";
      });
    const element = captions.at(-1);
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`;
  let point: { x: number; y: number } | null = null;
  try {
    point = (await window.webContents.mainFrame.executeJavaScript(findPointScript, true)) as {
      x: number;
      y: number;
    } | null;
  } catch {
    return;
  }
  if (!point) return;

  window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
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
  await delay(150);
  await appendFocusedText(window, caption);
}

async function waitForAndClickZhihuSingleImage(window: BrowserWindow): Promise<boolean> {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const state = await findAndClickZhihuSingleImageButton(window);
    if (state === "clicked") return true;
    await delay(250);
  }
  return false;
}

async function findAndClickZhihuSingleImageButton(
  window: BrowserWindow,
): Promise<"waiting_for_status" | "button_missing" | "clicked"> {
  const script = `(() => {
    const status = document.querySelector(".css-yihm2v");
    if (!(status?.textContent || "").includes("已上传 1 张图片")) {
      return "waiting_for_status";
    }
    const button = status?.parentElement
      ? Array.from(status.parentElement.querySelectorAll("button")).find(
          (candidate) => (candidate.textContent || "").trim() === "插入图片",
        )
      : null;
    if (!button) return "button_missing";
    button.click();
    return "clicked";
  })()`;
  try {
    const state = await window.webContents.mainFrame.executeJavaScript(script, true);
    return state === "button_missing" || state === "clicked" ? state : "waiting_for_status";
  } catch {
    return "waiting_for_status";
  }
}

async function waitForZhihuImageDialogToClose(window: BrowserWindow): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const closed = await window.webContents.mainFrame.executeJavaScript(
      `!document.querySelector(".css-yihm2v")`,
      true,
    );
    if (closed) return true;
    await delay(250);
  }
  return false;
}

async function clickZhihuLocalImageUpload(window: BrowserWindow): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const point = await findZhihuLocalImageUploadPoint(window);
    if (point) {
      window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
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
    }
    await delay(100);
  }
  return false;
}

async function findZhihuLocalImageUploadPoint(
  window: BrowserWindow,
): Promise<{ x: number; y: number } | null> {
  const script = `(() => {
    const targetText = "本地图片上传";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      if ((textNode.textContent || "").trim() === targetText) break;
      textNode = walker.nextNode();
    }
    const label = textNode?.parentElement;
    if (!label) return null;

    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = [];
    let element = label;
    for (let depth = 0; element && depth < 7; depth += 1, element = element.parentElement) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const semantic = element.matches("button, a, [role='button'], [tabindex]");
      const interactive = semantic || typeof element.onclick === "function" || style.cursor === "pointer";
      const cardSized = rect.width >= 80 && rect.width <= 360 && rect.height >= 55 && rect.height <= 300;
      if (interactive || cardSized) {
        candidates.push({
          element,
          score: (interactive ? 100 : 0) + (semantic ? 50 : 0) + (cardSized ? 20 : 0) + depth,
        });
      }
    }
    const selected = candidates.sort((left, right) => right.score - left.score)[0]?.element || label;
    selected.scrollIntoView({ block: "center", inline: "center" });
    const rect = selected.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`;
  try {
    return (await window.webContents.mainFrame.executeJavaScript(script, true)) as {
      x: number;
      y: number;
    } | null;
  } catch {
    return null;
  }
}

async function placeZhihuBodyCaretAtEnd(window: BrowserWindow): Promise<boolean> {
  const selectors = ZHIHU_SELECTORS.body;
  const findPointScript = `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const editor = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!editor) return null;
    const blocks = Array.from(editor.querySelectorAll("[data-block='true']"));
    const editableBlocks = blocks.filter((block) => {
      if (block.getAttribute("contenteditable") === "false") return false;
      if (block.closest("figure[contenteditable='false']")) return false;
      const rect = block.getBoundingClientRect();
      const style = getComputedStyle(block);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden";
    });
    const block = editableBlocks.at(-1);
    if (!block) return null;
    block.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = block.getBoundingClientRect();
    return {
      x: Math.round(rect.left + Math.min(12, rect.width / 2)),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`;
  const placeCaretScript = `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const editor = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!editor) return false;
    const blocks = Array.from(editor.querySelectorAll("[data-block='true']"));
    const editableBlocks = blocks.filter((block) => {
      if (block.getAttribute("contenteditable") === "false") return false;
      if (block.closest("figure[contenteditable='false']")) return false;
      const rect = block.getBoundingClientRect();
      const style = getComputedStyle(block);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden";
    });
    const block = editableBlocks.at(-1);
    if (!block) return false;
    const target = block.querySelector("[data-text='true']") ||
      block.querySelector(".public-DraftStyleDefault-block") || block;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return editor.contains(selection.anchorNode);
  })()`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let point: { x: number; y: number } | null = null;
    try {
      point = (await window.webContents.mainFrame.executeJavaScript(findPointScript, true)) as {
        x: number;
        y: number;
      } | null;
    } catch {
      point = null;
    }
    if (!point) {
      await delay(100);
      continue;
    }

    if (process.platform === "darwin") app.focus({ steal: true });
    window.show();
    window.moveTop();
    window.focus();
    window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
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
    await delay(100);
    if (await executeInFrames(window, placeCaretScript)) return true;
    await delay(100);
  }
  return false;
}

async function clickZhihuImageControl(window: BrowserWindow): Promise<boolean> {
  window.show();
  window.focus();
  await delay(200);
  const selectors = ZHIHU_SELECTORS.imageControl;
  const script = `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const explicit = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    const semantic = Array.from(document.querySelectorAll("button")).find((button) => {
      const signature = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-tooltip"),
        button.className,
        button.querySelector("svg")?.getAttribute("class"),
      ].filter(Boolean).join(" ");
      return /(插入?图片|插图|InsertImage|image|picture)/i.test(signature);
    });
    const element = explicit || semantic;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
      return null;
    }
    element.scrollIntoView({ block: "center", inline: "center" });
    const updatedRect = element.getBoundingClientRect();
    return {
      x: Math.round(updatedRect.left + updatedRect.width / 2),
      y: Math.round(updatedRect.top + updatedRect.height / 2),
    };
  })()`;
  try {
    const point = (await window.webContents.mainFrame.executeJavaScript(script, true)) as {
      x: number;
      y: number;
    } | null;
    if (!point) return false;
    window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
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

async function countZhihuBodyImages(window: BrowserWindow): Promise<number> {
  const selectors = ZHIHU_SELECTORS.body;
  const script = `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const editor = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    return editor ? editor.querySelectorAll("img").length : 0;
  })()`;
  try {
    const value = await window.webContents.mainFrame.executeJavaScript(script, true);
    return Number(value) || 0;
  } catch {
    return 0;
  }
}

async function pageLooksLoggedOut(window: BrowserWindow): Promise<boolean> {
  const script = `(() => {
    const text = document.body?.innerText || "";
    return ["登录知乎", "密码登录", "扫码登录", "注册/登录"].some((word) => text.includes(word));
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
      // Cross-origin and transient frames can disappear while the page is loading.
    }
  }
  return false;
}

function isAllowedZhihuUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return [
      "zhihu.com",
      "zhimg.com",
      "geetest.com",
      "open.weixin.qq.com",
      "graph.qq.com",
      "passport.weibo.com",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function waitForPageReady(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) {
    await delay(500);
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve())),
    delay(10_000),
  ]);
  await delay(500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
