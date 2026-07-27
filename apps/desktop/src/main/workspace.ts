import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type Artifact,
  artifactSchema,
  type CreateProjectInput,
  type FilePreview,
  type PersonaProfileInput,
  type PersonaRagStatus,
  type Project,
  projectSchema,
} from "@yoom/desktop-contracts";
import { projectFrontmatterSchema, serializeMarkdown } from "@yoom/markdown-schemas";
import { type FSWatcher, watch } from "chokidar";
import { resolveInsideProject, sanitizeDirectoryName } from "./path-policy";

const PROJECT_DIRECTORIES = [
  "文章",
  "图片",
  "流量数据/输入文件",
  "流量数据/分析报告",
  "创作策略",
  "视频",
  "发布记录",
] as const;

const PERSONA_RAG_DIRECTORY = "用户Persona RAG";
const PERSONA_FILE_NAME = "persona.md";

const OUTPUT_KINDS = new Map<string, Artifact["kind"]>([
  ["文章", "article"],
  ["图片", "image"],
  ["流量数据/分析报告", "analytics_report"],
  ["创作策略", "strategy"],
  ["视频", "video"],
  ["发布记录", "publish_receipt"],
]);

function now(): string {
  return new Date().toISOString();
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx");
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function mediaType(path: string): string {
  const types: Record<string, string> = {
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export class Workspace {
  readonly root: string;
  readonly database: DatabaseSync;
  #watcher: FSWatcher | null = null;

  constructor(root: string) {
    this.root = root;
    for (const directory of [
      "企业知识库",
      join("企业知识库", PERSONA_RAG_DIRECTORY),
      "任务",
      ".yoom/models",
      ".yoom/cache",
      ".yoom/logs",
      ".yoom/backups",
    ]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    const workspaceDocument = join(root, "workspace.md");
    if (!existsSync(workspaceDocument)) {
      atomicWrite(
        workspaceDocument,
        "# 获客智能助手工作区\n\n此目录中的本地文件是内容的唯一主数据。\n",
      );
    }
    this.database = new DatabaseSync(join(root, ".yoom", "workspace.sqlite"));
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS file_index (
        path TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at TEXT NOT NULL
      );
    `);
  }

  async startWatching(): Promise<void> {
    this.#watcher = watch([join(this.root, "任务"), join(this.root, "企业知识库")], {
      ignored: /(^|[\\/])\../,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
    });
    this.#watcher.on("add", (path) => this.indexFile(path));
    this.#watcher.on("change", (path) => this.indexFile(path));
    this.#watcher.on("unlink", (path) => {
      this.database.prepare("DELETE FROM file_index WHERE path = ?").run(path);
    });
  }

  close(): void {
    void this.#watcher?.close();
    this.database.close();
  }

  createProject(input: CreateProjectInput): Project {
    const id = randomUUID();
    const timestamp = now();
    const folder = `${sanitizeDirectoryName(input.name)}__${id.slice(0, 8)}`;
    const projectPath = join(this.root, "任务", folder);
    mkdirSync(projectPath, { recursive: false });
    for (const directory of PROJECT_DIRECTORIES) {
      mkdirSync(join(projectPath, directory), { recursive: true });
    }
    const frontmatter = projectFrontmatterSchema.parse({
      schema: "yoom.project/v1",
      id,
      name: input.name.trim(),
      created_at: timestamp,
    });
    atomicWrite(
      join(projectPath, "project.md"),
      serializeMarkdown(frontmatter, `# ${input.name.trim()}\n\n在主对话中描述本任务的目标。`),
    );
    const project = projectSchema.parse({
      id,
      name: input.name.trim(),
      path: projectPath,
      status: "ready",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.database
      .prepare(
        `INSERT INTO projects (id, name, path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.status,
        project.createdAt,
        project.updatedAt,
      );
    this.indexFile(join(projectPath, "project.md"), id);
    return project;
  }

  listProjects(): Project[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, path, status, created_at AS createdAt, updated_at AS updatedAt
         FROM projects ORDER BY updated_at DESC`,
      )
      .all();
    return rows.map((row) => projectSchema.parse(row));
  }

  personaRagStatus(): PersonaRagStatus {
    const path = this.personaRagPath();
    const fileCount = countVisibleFiles(path);
    const personaPath = join(path, PERSONA_FILE_NAME);
    return {
      ready: existsSync(personaPath) && statSync(personaPath).isFile(),
      fileCount,
      path,
    };
  }

  personaRagPath(): string {
    return join(this.root, "企业知识库", PERSONA_RAG_DIRECTORY);
  }

  buildPersonaRag(input: PersonaProfileInput): PersonaRagStatus {
    const persona = [
      "# 品牌核心 Persona",
      "",
      "> 这是品牌长期设定的主文件，可直接打开修改。执行内容任务时应完整读取。",
      "",
      "## 账号主体与业务",
      "",
      input.brandOverview.trim(),
      "",
      "## 目标人群",
      "",
      input.audience.trim(),
      "",
      "## 品牌定位、核心特点与长期认知",
      "",
      input.positioning.trim(),
      "",
      "## 固定事实、产品与服务资料",
      "",
      input.fixedFacts.trim(),
      "",
      "## 内容边界",
      "",
      input.contentBoundaries.trim(),
      "",
    ].join("\n");
    atomicWrite(join(this.personaRagPath(), PERSONA_FILE_NAME), persona);
    return this.personaRagStatus();
  }

  importPersonaRagFiles(sourcePaths: readonly string[]): string[] {
    const destinationRoot = join(this.personaRagPath(), "资料");
    mkdirSync(destinationRoot, { recursive: true });
    const imported: string[] = [];
    for (const sourcePath of sourcePaths) {
      if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) continue;
      const destination = nextAvailableFilePath(destinationRoot, basename(sourcePath));
      copyFileSync(sourcePath, destination);
      imported.push(basename(destination));
    }
    return imported;
  }

  personaRagReferenceContext(): string {
    const referencesRoot = join(this.personaRagPath(), "资料");
    const sections: string[] = [];
    let remaining = 50_000;
    const personaPath = join(this.personaRagPath(), PERSONA_FILE_NAME);
    if (existsSync(personaPath) && statSync(personaPath).isFile()) {
      const persona = readFileSync(personaPath, "utf8").slice(0, 20_000);
      const section = `[当前 Persona 主文件]\n${persona}`;
      sections.push(section);
      remaining -= section.length;
    }
    for (const path of visibleFilePaths(referencesRoot)) {
      if (remaining <= 0) break;
      const source = relative(referencesRoot, path).replaceAll("\\", "/");
      const extension = extname(path).toLowerCase();
      const readable = [".md", ".txt", ".csv", ".json", ".yaml", ".yml"].includes(extension);
      const content = readable
        ? readFileSync(path, "utf8").slice(0, Math.min(10_000, remaining))
        : "";
      const section = content
        ? `[本地参考资料：${source}]\n${content}`
        : `[本地参考文件：${source}，当前格式仅提供文件名]`;
      sections.push(section);
      remaining -= section.length;
    }
    return sections.join("\n\n");
  }

  deleteProject(projectId: string): void {
    const project = this.project(projectId);
    const tasksRoot = join(this.root, "任务");
    const projectRelativePath = relative(tasksRoot, project.path);
    if (
      !projectRelativePath ||
      projectRelativePath.startsWith("..") ||
      isAbsolute(projectRelativePath)
    ) {
      throw new Error("任务目录不在当前工作区内，无法删除");
    }

    let trashPath: string | null = null;
    if (existsSync(project.path)) {
      const trashRoot = join(this.root, ".yoom", "trash", "任务");
      mkdirSync(trashRoot, { recursive: true });
      trashPath = join(trashRoot, `${basename(project.path)}__${randomUUID()}`);
      renameSync(project.path, trashPath);
    }

    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database.prepare("DELETE FROM file_index WHERE project_id = ?").run(projectId);
      this.database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The transaction may not have started.
      }
      if (trashPath && existsSync(trashPath) && !existsSync(project.path)) {
        renameSync(trashPath, project.path);
      }
      throw error;
    }
  }

  project(projectId: string): Project {
    const row = this.database
      .prepare(
        `SELECT id, name, path, status, created_at AS createdAt, updated_at AS updatedAt
         FROM projects WHERE id = ?`,
      )
      .get(projectId);
    if (!row) throw new Error("任务不存在");
    return projectSchema.parse(row);
  }

  listOutputs(projectId: string): Artifact[] {
    const project = this.project(projectId);
    const artifacts: Artifact[] = [];
    for (const [directory, kind] of OUTPUT_KINDS) {
      const root = join(project.path, directory);
      this.walk(root, (path) => {
        const stats = statSync(path);
        artifacts.push(
          artifactSchema.parse({
            id: relative(project.path, path).replaceAll("\\", "/"),
            projectId,
            kind,
            name: basename(path),
            path: relative(project.path, path).replaceAll("\\", "/"),
            mediaType: mediaType(path),
            updatedAt: stats.mtime.toISOString(),
          }),
        );
      });
    }
    return artifacts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  preview(projectId: string, candidate: string): FilePreview {
    const project = this.project(projectId);
    const path = resolveInsideProject(project.path, candidate);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error("文件不存在");
    const type = mediaType(path);
    const readable = type.startsWith("text/") || type === "application/json";
    return {
      path,
      mediaType: type,
      content: readable ? readFileSync(path, "utf8") : null,
    };
  }

  resolveFile(projectId: string, candidate: string): string {
    const project = this.project(projectId);
    const path = resolveInsideProject(project.path, candidate);
    if (!existsSync(path)) throw new Error("文件不存在");
    return path;
  }

  private walk(root: string, onFile: (path: string) => void): void {
    if (!existsSync(root)) return;
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) this.walk(path, onFile);
      else if (!entry.name.endsWith(".tmp")) onFile(path);
    }
  }

  private indexFile(path: string, knownProjectId?: string): void {
    if (!existsSync(path) || !statSync(path).isFile()) return;
    const project =
      knownProjectId ??
      this.listProjects().find((candidate) => {
        try {
          resolveInsideProject(candidate.path, relative(candidate.path, path));
          return path.startsWith(candidate.path);
        } catch {
          return false;
        }
      })?.id;
    if (!project) return;
    const stats = statSync(path);
    this.database
      .prepare(
        `INSERT INTO file_index (path, project_id, media_type, size, modified_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           project_id = excluded.project_id,
           media_type = excluded.media_type,
           size = excluded.size,
           modified_at = excluded.modified_at`,
      )
      .run(path, project, mediaType(path), stats.size, stats.mtime.toISOString());
  }
}

function countVisibleFiles(root: string): number {
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) count += countVisibleFiles(path);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function visibleFilePaths(root: string): string[] {
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...visibleFilePaths(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function nextAvailableFilePath(directory: string, originalName: string): string {
  const extension = extname(originalName);
  const stem = basename(originalName, extension);
  let candidate = join(directory, originalName);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(directory, `${stem}-${suffix}${extension}`);
    suffix += 1;
  }
  return candidate;
}
