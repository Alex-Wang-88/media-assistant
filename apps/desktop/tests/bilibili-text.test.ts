import { describe, expect, it } from "vitest";
import { countConfirmedTrailingPasteCleanupKeystrokes } from "../src/main/platforms/bilibili/text";

describe("Bilibili editor paste artifacts", () => {
  it("recognizes the confirmed sentinel, space, and newline structure", () => {
    expect(countConfirmedTrailingPasteCleanupKeystrokes("\u200b你好 \n", "你好")).toBe(1);
  });

  it("does not remove unconfirmed suffixes or changed content", () => {
    expect(countConfirmedTrailingPasteCleanupKeystrokes("\u200b你好 ", "你好")).toBe(0);
    expect(countConfirmedTrailingPasteCleanupKeystrokes("\u200b你好吗 \n", "你好")).toBe(0);
    expect(countConfirmedTrailingPasteCleanupKeystrokes("你好。 \n", "你好")).toBe(0);
  });
});
