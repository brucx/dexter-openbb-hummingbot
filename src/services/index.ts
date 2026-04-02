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

export { buildProposal, autoDraftProposal, assessDataQuality } from "./proposal";
export type { ProposalInput, ProposalResult, DataQualityAssessment, SourceStatus } from "./proposal";

export { createProposalStore } from "./persistence";
export type { ProposalStore, StatusUpdate } from "./persistence";

export { formatProposal, formatProposalList } from "./format";
export type { ResearchSummary } from "./format";
