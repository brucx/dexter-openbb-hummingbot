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

## Next Implementation Target

- [ ] Trade analysis skill (SKILL.md) — guided research → proposal workflow
- [ ] CLI commands wrapping persistence (list, show proposals)
- [ ] Embed research data points in formatted proposal display
- [ ] Emit `trade_proposal` event for Dexter event stream integration
- [ ] Phase 3: Hummingbot paper trading bridge (when ready)
