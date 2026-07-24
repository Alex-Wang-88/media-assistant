import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
if (args.has("--help") || !args.get("--models") || !args.get("--plugins")) {
  console.log("用法: node scripts/import-yunrong-catalog.mjs --models <模型md> --plugins <插件md>");
  process.exit(args.has("--help") ? 0 : 1);
}

const modelSource = await readFile(resolve(args.get("--models")), "utf8");
const pluginSource = await readFile(resolve(args.get("--plugins")), "utf8");

const stableId = (namespace, value) =>
  `yunrong.${namespace}.${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

let provider = "";
const models = [];
for (const line of modelSource.split(/\r?\n/)) {
  const heading = /^## \d+\.\s+(.+?)（\d+个模型）$/.exec(line);
  if (heading) {
    provider = heading[1];
    continue;
  }
  if (line.startsWith("## ")) {
    provider = "";
    continue;
  }
  const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|$/.exec(line);
  if (!row || row[1] === "模型名称" || !provider) continue;
  models.push({
    id: stableId("model", `${provider}\0${row[1]}`),
    provider,
    name: row[1].trim(),
    capabilities: row[2].trim() === "-" ? [] : row[2].split(",").map((value) => value.trim()),
    sessionCost: Number(row[3]),
  });
}

const parsePluginTable = (heading, type) => {
  const start = pluginSource.indexOf(`## ${heading}`);
  const next = pluginSource.indexOf("\n## ", start + 4);
  const section = pluginSource.slice(start, next < 0 ? undefined : next);
  const entries = [];
  for (const line of section.split(/\r?\n/)) {
    const row = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(是|否)\s*\|$/.exec(line);
    if (!row) continue;
    entries.push({
      id: stableId(`plugin.${type.toLowerCase()}`, row[3].trim()),
      type,
      category: row[2].trim(),
      name: row[3].trim(),
      paid: row[4] === "是",
    });
  }
  return entries;
};
const plugins = [
  ...parsePluginTable("HTTP 插件清单", "HTTP"),
  ...parsePluginTable("MCP 插件清单", "MCP"),
];

if (models.length !== 131) throw new Error(`期望 131 个模型，实际解析 ${models.length} 个`);
if (plugins.length !== 68) throw new Error(`期望 68 个插件，实际解析 ${plugins.length} 个`);

const targets = [
  [
    "apps/api/app/catalog/yunrong-models.json",
    {
      schema: "yoom.yunrong-model-catalog/v1",
      sourceDate: "2026-07-01",
      models,
    },
  ],
  [
    "apps/api/app/catalog/yunrong-plugins.json",
    {
      schema: "yoom.yunrong-plugin-catalog/v1",
      sourceDate: "2026-06-22",
      plugins,
    },
  ],
];
for (const [target, value] of targets) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`${target}: ${value.models?.length ?? value.plugins.length}`);
}
