# Next Steps — Implementation Pass

## Phase 1: Make End-to-End Solid — COMPLETE

- [x] Bridge client, OpenBB bridge (live + fallback), ResearchService all working
- [x] research-demo.ts runs full pipeline: bridge → research → proposal
- [x] Unit tests pass (18/18)
- [x] Add `requirements.txt` for the Python bridge
- [x] Add integration test: bridge → ResearchService → proposal pipeline (28 tests)
- [x] Update docs/TASKS.md to reflect actual Phase 1 completion state

## Phase 2 Minimum Slice: Proposal Persistence + CLI Display — COMPLETE

- [x] Proposal persistence: save TradeIntent to `data/proposals/<id>.json`
- [x] Load/list saved proposals (`createProposalStore()`)
- [x] CLI formatting: `formatProposal()` for readable terminal output
- [x] CLI formatting: `formatProposalList()` for summary tables
- [x] Demo script uses persistence and formatting end-to-end
- [x] Persistence and format tests (24 tests)
- [x] Update TASKS.md and README for Phase 2 status

## Phase 2.5: Proposal CLI & Review Workflow — COMPLETE

- [x] CLI entry point (`src/cli.ts`) with `proposals` subcommands
- [x] `proposals list` — view all saved proposals with short IDs, filterable by `--status`
- [x] `proposals show <id>` — detailed view of a single proposal (supports prefix matching)
- [x] `proposals approve <id>` — mark a proposal as approved (records who + when)
- [x] `proposals reject <id> --reason "..."` — reject with optional reason
- [x] `updateStatus()` in ProposalStore — persist approval/rejection metadata
- [x] Enhanced `formatProposal()` — shows approval/rejection info, optional ResearchSummary
- [x] `formatProposalList()` — now includes short ID column for easy reference
- [x] Guard against double-approve/reject (only `proposed` status can transition)
- [x] CLI tests (34 tests)
- [x] npm scripts: `cli`, `test:cli`

## Phase 2.6: Proposal Review UX — COMPLETE

Goal: Make `proposals show` useful enough for a human operator to judge a proposal
without re-running research or guessing what data was available.

- [x] Persist research snapshot as sidecar file (`{id}.research.json`) alongside proposals
- [x] Extract key research data points into enriched ResearchSummary (financials, news headlines)
- [x] Show explicit data availability section: which sources succeeded / failed / used fallback
- [x] Enrich `proposals show` with financials highlights (revenue, EPS, net income) and top news
- [x] Add price context (current price, day change) to `proposals list` for faster scanning
- [x] Handle missing/partial research gracefully — honest display, never hidden
- [x] Review UX tests (77 tests)

## Phase 2.7: Partial Research Graceful Degradation — COMPLETE

Goal: Make proposals more honest and robust when some research inputs are missing
or fallback/sample-based. Data quality affects proposal content, not just display.

- [x] `assessDataQuality()` — scores ResearchSnapshot completeness (live/fallback/missing per source)
- [x] Confidence capping: proposal confidence auto-capped based on data availability
  - Quote missing → max "low" (no price = no conviction)
  - Any core source (quote/history/financials) missing → max "medium"
  - Core sources present but fallback → max "medium"
  - All core sources live → max "high" (news is supplementary)
- [x] Thesis caveats: auto-prefixed with `[LIMITED DATA]` or `[WEAK EVIDENCE]` when warranted
- [x] Risk injection: data-gap risks auto-appended to `key_risks` (no duplicates)
- [x] `DataQualityAssessment` attached to every `ProposalResult` for downstream consumers
- [x] Data quality tests (32 tests)

## Next Implementation Target

- [ ] Trade analysis skill (SKILL.md) — guided research → proposal workflow
- [ ] Emit `trade_proposal` event for Dexter event stream integration
- [ ] Phase 3: Hummingbot paper trading bridge (when ready)
