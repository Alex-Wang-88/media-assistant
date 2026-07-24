import { isAbsolute, relative, resolve } from "node:path";

export function resolveInsideProject(projectRoot: string, candidate: string): string {
  const root = resolve(projectRoot);
  const target = resolve(root, candidate);
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }
  throw new Error("拒绝访问项目目录之外的路径");
}

export function sanitizeDirectoryName(name: string): string {
  const sanitized = name
    .normalize("NFKC")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return sanitized.slice(0, 60) || "未命名任务";
}
