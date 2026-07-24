export type AssociationConfidence = "high" | "medium" | "low";

export type AssociationEvidence = {
  articleId?: string;
  url?: string;
  exactTitle?: boolean;
  fuzzyTitle?: boolean;
  dailyAggregateOnly?: boolean;
};

export type ConfidenceDecision = {
  confidence: AssociationConfidence;
  requiresConfirmation: boolean;
  canUpdateStrategy: boolean;
  reason: string;
};

export function classifyAssociation(evidence: AssociationEvidence): ConfidenceDecision {
  if (evidence.articleId || evidence.url || evidence.exactTitle) {
    return {
      confidence: "high",
      requiresConfirmation: false,
      canUpdateStrategy: true,
      reason: "指标可精确关联到单篇文章",
    };
  }
  if (evidence.fuzzyTitle && !evidence.dailyAggregateOnly) {
    return {
      confidence: "medium",
      requiresConfirmation: true,
      canUpdateStrategy: false,
      reason: "标题仅为模糊匹配，需要用户确认",
    };
  }
  return {
    confidence: "low",
    requiresConfirmation: false,
    canUpdateStrategy: false,
    reason: "只有日级平台总量，只能用于趋势分析",
  };
}

export function growthRate(previous: number, current: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
