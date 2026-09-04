import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import type { PublishAutomationResult, XAccount } from "@yoom/desktop-contracts";
import { app, safeStorage, shell } from "electron";

const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_CURRENT_USER_URL = "https://api.x.com/2/users/me";
const X_MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
const X_CREATE_POST_URL = "https://api.x.com/2/tweets";
const DEFAULT_CALLBACK_URL = "http://127.0.0.1:47821/oauth/x/callback";
const OAUTH_TIMEOUT_MS = 10 * 60 * 1_000;
const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];

type XToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

type StoredXApiAccount = {
  id: string;
  userId: string;
  username: string;
  name: string;
  encryptedToken: string;
};

type XTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

export function isXApiConfigured(): boolean {
  return Boolean(process.env.X_OAUTH_CLIENT_ID?.trim());
}

export function hasXApiAccount(accountId: string): boolean {
  return loadXApiAccounts().some((account) => account.id === accountId);
}

export function listXApiAccounts(): XAccount[] {
  return loadXApiAccounts().map(({ id, name }) => ({ id, name, mode: "api" }));
}

export async function authorizeXApiAccount(): Promise<XAccount> {
  const clientId = requiredEnvironment("X_OAUTH_CLIENT_ID");
  const callbackUrl = readCallbackUrl();
  const state = randomUrlSafeString(32);
  const codeVerifier = randomUrlSafeString(64);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const callback = await startOAuthCallback(callbackUrl, state);
  const authorizationUrl = new URL(X_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl.toString());
  authorizationUrl.searchParams.set("scope", X_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  try {
    await shell.openExternal(authorizationUrl.toString());
    const code = await callback.waitForCode;
    const token = await exchangeAuthorizationCode(clientId, callbackUrl, code, codeVerifier);
    const identity = await loadCurrentXUser(token.accessToken);
    const storedAccounts = loadXApiAccounts();
    const existing = storedAccounts.find((account) => account.userId === identity.id);
    const account: StoredXApiAccount = {
      id: existing?.id ?? randomUUID(),
      userId: identity.id,
      username: identity.username,
      name: formatAccountName(identity.name, identity.username),
      encryptedToken: encryptToken(token),
    };
    saveXApiAccounts([
      account,
      ...storedAccounts.filter((candidate) => candidate.userId !== identity.id),
    ]);
    return { id: account.id, name: account.name, mode: "api" };
  } finally {
    callback.close();
  }
}

export function deleteXApiAccount(accountId: string): XAccount[] {
  const accounts = loadXApiAccounts();
  if (!accounts.some((account) => account.id === accountId)) {
    throw new Error("要删除的 X API 账号不存在");
  }
  const nextAccounts = accounts.filter((account) => account.id !== accountId);
  saveXApiAccounts(nextAccounts);
  return nextAccounts.map(({ id, name }) => ({ id, name, mode: "api" }));
}

export async function publishXApiPost(
  accountId: string,
  content: string,
  assetPaths: readonly string[],
): Promise<PublishAutomationResult> {
  if (!content.trim()) throw new Error("请先填写 X 推文内容");
  if (assetPaths.length > 4) throw new Error("X 每条帖子最多添加 4 张配图");
  let account = requireXApiAccount(accountId);
  let token = await validToken(account);
  account = requireXApiAccount(accountId);

  try {
    return await createPost(token.accessToken, content, assetPaths);
  } catch (error) {
    if (!isUnauthorizedXError(error) || !token.refreshToken) throw error;
    token = await refreshAccessToken(account, token.refreshToken);
    return createPost(token.accessToken, content, assetPaths);
  }
}

async function createPost(
  accessToken: string,
  content: string,
  assetPaths: readonly string[],
): Promise<PublishAutomationResult> {
  const mediaIds: string[] = [];
  for (const path of assetPaths) mediaIds.push(await uploadImage(accessToken, path));
  const response = await fetch(X_CREATE_POST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: content,
      ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
    }),
  });
  const payload = await readJsonResponse(response, "X 发布失败");
  const postId = readNestedString(payload, "data", "id");
  if (!postId) throw new Error("X 已接受请求，但响应中没有帖子编号");
  return {
    state: "published",
    message: `已通过 X API 发布，帖子编号：${postId}`,
  };
}

async function uploadImage(accessToken: string, path: string): Promise<string> {
  const file = statSync(path);
  if (!file.isFile()) throw new Error(`X 配图不存在：${path}`);
  if (file.size > 5 * 1024 * 1024) throw new Error("X API 的单张图片大小不能超过 5 MB");
  const mediaType = imageMediaType(path);
  const response = await fetch(X_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media: readFileSync(path).toString("base64"),
      media_category: "tweet_image",
      media_type: mediaType,
      shared: false,
    }),
  });
  const payload = await readJsonResponse(response, "X 配图上传失败");
  const mediaId = readNestedString(payload, "data", "id");
  if (!mediaId) throw new Error("X 已接收图片，但响应中没有媒体编号");
  return mediaId;
}

function imageMediaType(path: string): string {
  switch (extname(path).toLocaleLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      throw new Error("X API 配图仅支持 JPG、PNG 和 WEBP");
  }
}

async function validToken(account: StoredXApiAccount): Promise<XToken> {
  const token = decryptToken(account.encryptedToken);
  if (token.expiresAt > Date.now() + 60_000) return token;
  if (!token.refreshToken) throw new Error("X 登录已过期，请删除该账号后重新授权");
  return refreshAccessToken(account, token.refreshToken);
}

async function refreshAccessToken(
  account: StoredXApiAccount,
  refreshToken: string,
): Promise<XToken> {
  const clientId = requiredEnvironment("X_OAUTH_CLIENT_ID");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await readJsonResponse(response, "刷新 X 登录状态失败")) as XTokenResponse;
  const token = tokenFromResponse(payload, refreshToken);
  saveXApiAccounts(
    loadXApiAccounts().map((candidate) =>
      candidate.id === account.id
        ? { ...candidate, encryptedToken: encryptToken(token) }
        : candidate,
    ),
  );
  return token;
}

async function exchangeAuthorizationCode(
  clientId: string,
  callbackUrl: URL,
  code: string,
  codeVerifier: string,
): Promise<XToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl.toString(),
    code_verifier: codeVerifier,
    client_id: clientId,
  });
  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await readJsonResponse(response, "X 授权码交换失败")) as XTokenResponse;
  return tokenFromResponse(payload, null);
}

function tokenFromResponse(payload: XTokenResponse, previousRefreshToken: string | null): XToken {
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("X OAuth 响应中缺少访问令牌");
  }
  const expiresIn =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 7_200;
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token
        ? payload.refresh_token
        : previousRefreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000,
  };
}

async function loadCurrentXUser(
  accessToken: string,
): Promise<{ id: string; name: string; username: string }> {
  const response = await fetch(X_CURRENT_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJsonResponse(response, "读取 X 账号信息失败");
  const id = readNestedString(payload, "data", "id");
  const name = readNestedString(payload, "data", "name");
  const username = readNestedString(payload, "data", "username");
  if (!id || !name || !username) throw new Error("X 账号信息响应不完整");
  return { id, name, username };
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // Keep the response generic when the service does not return JSON.
  }
  if (!response.ok) {
    const detail =
      readStringField(payload, "detail") ??
      readStringField(payload, "title") ??
      readStringField(payload, "error_description") ??
      `${response.status} ${response.statusText}`;
    throw new XApiError(response.status, `${label}：${detail}`);
  }
  return payload;
}

class XApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isUnauthorizedXError(error: unknown): error is XApiError {
  return error instanceof XApiError && error.status === 401;
}

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function readNestedString(value: unknown, parent: string, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  return readStringField((value as Record<string, unknown>)[parent], key);
}

function formatAccountName(name: string, username: string): string {
  return Array.from(`${name.trim()}（@${username.trim()}）`).slice(0, 40).join("");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`X API 尚未配置，请在 .env 设置 ${name}`);
  return value;
}

function readCallbackUrl(): URL {
  const value = process.env.X_OAUTH_CALLBACK_URL?.trim() || DEFAULT_CALLBACK_URL;
  const callbackUrl = new URL(value);
  if (
    callbackUrl.protocol !== "http:" ||
    callbackUrl.hostname !== "127.0.0.1" ||
    !callbackUrl.port ||
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.search ||
    callbackUrl.hash
  ) {
    throw new Error("X_OAUTH_CALLBACK_URL 必须是带固定端口的 http://127.0.0.1 回调地址");
  }
  return callbackUrl;
}

function randomUrlSafeString(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

async function startOAuthCallback(
  callbackUrl: URL,
  expectedState: string,
): Promise<{ waitForCode: Promise<string>; close(): void }> {
  let settled = false;
  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", callbackUrl.origin);
    if (requestUrl.pathname !== callbackUrl.pathname) {
      response.writeHead(404).end("Not found");
      return;
    }
    const state = requestUrl.searchParams.get("state");
    if (state !== expectedState) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("X OAuth state validation failed. Return to the desktop app and try again.");
      return;
    }
    const authorizationError = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><meta charset=utf-8><title>X 授权完成</title>" +
        "<body style='font-family:system-ui;padding:48px;background:#111;color:#fff'>" +
        "<h1>X 授权流程已完成</h1><p>现在可以关闭此页面并返回获客智能助手。</p></body>",
    );
    if (settled) return;
    settled = true;
    if (authorizationError) {
      rejectCode(new Error(`X 授权未完成：${authorizationError}`));
    } else if (!code) {
      rejectCode(new Error("X 授权回调中缺少授权码"));
    } else {
      resolveCode(code);
    }
  });
  try {
    await listen(server, Number(callbackUrl.port));
  } catch (error) {
    server.close();
    throw new Error(
      `无法监听 X OAuth 回调地址：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  server.on("error", (error) => {
    if (settled) return;
    settled = true;
    rejectCode(new Error(`X OAuth 回调服务异常：${error.message}`));
  });
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode(new Error("等待 X 授权超时，请重新发起登录"));
  }, OAUTH_TIMEOUT_MS);
  return {
    waitForCode,
    close: () => {
      clearTimeout(timeout);
      server.close();
    },
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", handleError);
      resolve();
    });
  });
}

function xApiStorageRoot(): string {
  const root = join(app.getPath("userData"), "private-platform-sessions", "x-api");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function xApiAccountPath(): string {
  return join(xApiStorageRoot(), "accounts.json");
}

function loadXApiAccounts(): StoredXApiAccount[] {
  const path = xApiAccountPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredXApiAccount) : [];
  } catch {
    return [];
  }
}

function saveXApiAccounts(accounts: readonly StoredXApiAccount[]): void {
  const target = xApiAccountPath();
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function isStoredXApiAccount(value: unknown): value is StoredXApiAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredXApiAccount>;
  return (
    typeof account.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account.id) &&
    typeof account.userId === "string" &&
    /^\d{1,30}$/.test(account.userId) &&
    typeof account.username === "string" &&
    account.username.trim().length > 0 &&
    typeof account.name === "string" &&
    account.name.trim().length > 0 &&
    typeof account.encryptedToken === "string" &&
    account.encryptedToken.length > 0
  );
}

function requireXApiAccount(accountId: string): StoredXApiAccount {
  const account = loadXApiAccounts().find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("选择的 X API 账号不存在，请重新授权");
  return account;
}

function encryptToken(token: XToken): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储暂不可用，无法保存 X 登录令牌");
  }
  return safeStorage.encryptString(JSON.stringify(token)).toString("base64");
}

function decryptToken(value: string): XToken {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储暂不可用，无法读取 X 登录令牌");
  }
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64"))) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid token");
    const token = parsed as Partial<XToken>;
    if (
      typeof token.accessToken !== "string" ||
      !token.accessToken ||
      (token.refreshToken !== null && typeof token.refreshToken !== "string") ||
      typeof token.expiresAt !== "number" ||
      !Number.isFinite(token.expiresAt)
    ) {
      throw new Error("invalid token");
    }
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? null,
      expiresAt: token.expiresAt,
    };
  } catch {
    throw new Error("X 登录令牌无法解密，请删除该账号后重新授权");
  }
}
