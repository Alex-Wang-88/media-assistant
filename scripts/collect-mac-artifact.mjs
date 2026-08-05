import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = join(projectRoot, ".build", "mac");
const releaseDirectory = join(projectRoot, "release");

if (!existsSync(buildDirectory)) {
  throw new Error(`找不到 macOS 构建目录：${buildDirectory}`);
}

const artifacts = readdirSync(buildDirectory).filter(
  (name) => name.endsWith("-arm64.dmg") && !name.startsWith("."),
);

if (artifacts.length === 0) {
  throw new Error("没有找到 ARM64 DMG 安装包");
}

if (artifacts.length > 1) {
  throw new Error(`发现多个 ARM64 DMG，请先检查构建目录：${artifacts.join(", ")}`);
}

mkdirSync(releaseDirectory, { recursive: true });

const artifactName = artifacts[0];
const source = join(buildDirectory, artifactName);
const target = join(releaseDirectory, artifactName);

copyFileSync(source, target);

console.log(`安装包已生成：${target}`);