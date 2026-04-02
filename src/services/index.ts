export { ResearchService } from "./research";
export type {
  QuoteData,
  PriceHistoryData,
  PriceRecord,
  FinancialsData,
  NewsData,
  NewsArticle,
  ResearchSnapshot,
} from "./research";

export { buildProposal, autoDraftProposal, autoDraftProposalWithLLM, assessDataQuality } from "./proposal";
export type { ProposalInput, ProposalResult, DataQualityAssessment, SourceStatus, LLMProposalOptions } from "./proposal";

export { detectLLMConfig } from "./llm-config";
export type { LLMConfig, LLMProvider, LLMAvailability } from "./llm-config";

export { analyzeWithLLM } from "./llm-analysis";
export type { LLMAnalysisResult } from "./llm-analysis";

export { createProposalStore } from "./persistence";
export type { ProposalStore, StatusUpdate } from "./persistence";

export { formatProposal, formatProposalList } from "./format";
export type { ResearchSummary } from "./format";

export { analyzeSymbol } from "./workflow";
export type { AnalyzeOptions, AnalyzeResult } from "./workflow";
