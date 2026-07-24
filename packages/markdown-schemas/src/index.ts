import YAML from "yaml";
import { z } from "zod";

export const tagsSchema = z.object({
  topics: z.array(z.string()).default([]),
  style: z.array(z.string()).default([]),
  tone: z.array(z.string()).default([]),
  audience: z.array(z.string()).default([]),
  format: z.array(z.string()).default([]),
  industry: z.array(z.string()).default([]),
  free: z.array(z.string()).default([]),
});

const baseFrontmatterSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  generated_at: z.iso.datetime({ offset: true }),
  tags_version: z.number().int().positive().default(1),
  tags: tagsSchema.default({
    topics: [],
    style: [],
    tone: [],
    audience: [],
    format: [],
    industry: [],
    free: [],
  }),
});

export const articleFrontmatterSchema = baseFrontmatterSchema.extend({
  schema: z.literal("yoom.article/v1"),
  platform: z.enum(["wechat", "toutiao", "zhihu", "weibo", "bilibili", "xiaohongshu"]),
  published_at: z.iso.datetime({ offset: true }).nullable().default(null),
});

export const projectFrontmatterSchema = z.object({
  schema: z.literal("yoom.project/v1"),
  id: z.uuid(),
  name: z.string().min(1).max(80),
  created_at: z.iso.datetime({ offset: true }),
});

export type ArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;
export type ProjectFrontmatter = z.infer<typeof projectFrontmatterSchema>;

export function serializeMarkdown(frontmatter: unknown, body: string): string {
  return `---\n${YAML.stringify(frontmatter)}---\n\n${body.trim()}\n`;
}

export function parseMarkdown<T>(
  source: string,
  schema: z.ZodType<T>,
): { frontmatter: T; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match?.[1]) {
    throw new Error("Markdown 缺少有效的 YAML frontmatter");
  }
  return {
    frontmatter: schema.parse(YAML.parse(match[1])),
    body: match[2]?.trim() ?? "",
  };
}
