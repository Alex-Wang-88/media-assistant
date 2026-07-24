import { describe, expect, it } from "vitest";
import { classifyAssociation, growthRate } from "../src/workers/analytics";

describe("deterministic analytics", () => {
  it("never creates high-confidence attribution from daily totals", () => {
    expect(classifyAssociation({ dailyAggregateOnly: true })).toEqual({
      confidence: "low",
      requiresConfirmation: false,
      canUpdateStrategy: false,
      reason: "只有日级平台总量，只能用于趋势分析",
    });
  });

  it("requires confirmation for fuzzy title matching", () => {
    expect(classifyAssociation({ fuzzyTitle: true }).requiresConfirmation).toBe(true);
  });

  it("computes growth without dividing by zero", () => {
    expect(growthRate(100, 125)).toBe(0.25);
    expect(growthRate(0, 10)).toBeNull();
  });
});
