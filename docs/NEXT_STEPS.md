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

## Next Implementation Target

- [ ] Trade analysis skill (SKILL.md) — guided research → proposal workflow
- [ ] Embed ResearchSummary in saved proposals at creation time (persist research data points)
- [ ] Emit `trade_proposal` event for Dexter event stream integration
- [ ] Phase 3: Hummingbot paper trading bridge (when ready)
