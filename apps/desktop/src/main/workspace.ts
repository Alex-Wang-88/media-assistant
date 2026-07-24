import { randomUUID } from "node:crypto";
import {
  closeSync,
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
import { basename, dirname, extname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type Artifact,
  artifactSchema,
  type CreateProjectInput,
  type FilePreview,
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
