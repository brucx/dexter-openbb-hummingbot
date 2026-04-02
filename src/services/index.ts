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

export { buildProposal, autoDraftProposal } from "./proposal";
export type { ProposalInput, ProposalResult } from "./proposal";

export { createProposalStore } from "./persistence";
export type { ProposalStore } from "./persistence";

export { formatProposal, formatProposalList } from "./format";
