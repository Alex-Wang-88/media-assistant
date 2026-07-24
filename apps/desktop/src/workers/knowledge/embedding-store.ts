export type KnowledgeChunk = {
  id: string;
  source: string;
  text: string;
  embedding: Float32Array;
};

export type KnowledgeMatch = {
  id: string;
  source: string;
  text: string;
  score: number;
};

export interface EmbeddingStore {
  replaceSource(source: string, chunks: KnowledgeChunk[]): Promise<void>;
  search(query: Float32Array, limit: number): Promise<KnowledgeMatch[]>;
}

export class MemoryEmbeddingStore implements EmbeddingStore {
  readonly #chunks = new Map<string, KnowledgeChunk>();

  async replaceSource(source: string, chunks: KnowledgeChunk[]): Promise<void> {
    for (const [id, chunk] of this.#chunks) {
      if (chunk.source === source) this.#chunks.delete(id);
    }
    for (const chunk of chunks) {
      if (chunk.source !== source) throw new Error("知识片段 source 与待替换来源不一致");
      this.#chunks.set(chunk.id, chunk);
    }
  }

  async search(query: Float32Array, limit: number): Promise<KnowledgeMatch[]> {
    return [...this.#chunks.values()]
      .map((chunk) => ({
        id: chunk.id,
        source: chunk.source,
        text: chunk.text,
        score: cosineSimilarity(query, chunk.embedding),
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}
