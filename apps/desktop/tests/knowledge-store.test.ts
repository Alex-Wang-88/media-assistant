import { describe, expect, it } from "vitest";
import { MemoryEmbeddingStore } from "../src/workers/knowledge/embedding-store";

describe("knowledge retrieval", () => {
  it("returns only the requested top matches", async () => {
    const store = new MemoryEmbeddingStore();
    await store.replaceSource("产品手册.md", [
      {
        id: "relevant",
        source: "产品手册.md",
        text: "企业获客产品",
        embedding: new Float32Array([1, 0]),
      },
      {
        id: "unrelated",
        source: "产品手册.md",
        text: "不会命中的内容",
        embedding: new Float32Array([-1, 0]),
      },
    ]);
    const result = await store.search(new Float32Array([1, 0]), 1);
    expect(result.map((match) => match.id)).toEqual(["relevant"]);
  });
});
