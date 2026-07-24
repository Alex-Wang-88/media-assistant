export const tagOntologyVersion = 1;

export const fixedTags = {
  tone: [
    { id: "tone.professional", label: "专业", synonyms: ["商务", "严谨"] },
    { id: "tone.friendly", label: "亲和", synonyms: ["亲切", "轻松"] },
  ],
  format: [
    { id: "format.guide", label: "指南", synonyms: ["教程", "攻略"] },
    { id: "format.case-study", label: "案例", synonyms: ["案例研究"] },
  ],
} as const;

export function normalizeTag(dimension: keyof typeof fixedTags, value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase("zh-CN");
  const match = fixedTags[dimension].find(
    (tag) =>
      tag.id.toLocaleLowerCase("zh-CN") === normalized ||
      tag.label.toLocaleLowerCase("zh-CN") === normalized ||
      tag.synonyms.some((synonym) => synonym.toLocaleLowerCase("zh-CN") === normalized),
  );
  return match?.id ?? null;
}
