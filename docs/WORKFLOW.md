# Trade Analysis Workflow

The `analyze` command is the primary entrypoint for generating trade proposals
from market research. It orchestrates the full pipeline in a single step.

## Pipeline

```
  dexter analyze <SYMBOL>
         │
         ▼
  ┌─────────────────────────────┐
  │  1. Gather Research         │  OpenBB bridge fetches quote, price history,
  │     (parallel)              │  financials, and news. Individual failures
  │                             │  are captured — the pipeline continues.
  └─────────────┬───────────────┘
                │
                ▼
  ┌─────────────────────────────┐
  │  2. Assess Data Quality     │  Each source is scored: live / fallback / missing.
  │                             │  Max justified confidence is determined.
  │                             │  Data-gap risk warnings are generated.
  └─────────────┬───────────────┘
                │
                ▼
  ┌─────────────────────────────┐
  │  3. Generate Proposal       │  Auto-draft trade proposal with graceful
  │     (with degradation)      │  degradation: confidence capped, thesis
  │                             │  caveated, risks injected from data gaps.
  └─────────────┬───────────────┘
                │
                ▼
  ┌─────────────────────────────┐
  │  4. Persist                 │  Proposal saved to data/proposals/{id}.json
  │                             │  Research snapshot saved as sidecar:
  │                             │  data/proposals/{id}.research.json
  └─────────────┬───────────────┘
                │
                ▼
  ┌─────────────────────────────┐
  │  5. Review in CLI           │  Output points user to next commands:
  │                             │    proposals show <id>
  │                             │    proposals approve <id>
  │                             │    proposals reject <id>
  └─────────────────────────────┘
```

## Usage

```bash
# Analyze a symbol (auto bridge mode — tries live OpenBB, falls back to sample)
npm run cli analyze AAPL

# Force live data (requires OpenBB SDK installed)
OPENBB_BRIDGE_MODE=live npm run cli analyze MSFT

# Force sample/fallback data (no dependencies needed)
OPENBB_BRIDGE_MODE=fallback npm run cli analyze TSLA

# Use a specific Python with OpenBB installed
OPENBB_PYTHON_BIN=.venv-openbb/bin/python3 npm run cli analyze AAPL
```

## Full Workflow Example

```bash
# Step 1: Analyze — generates proposal from research
$ npm run cli analyze AAPL

# Step 2: Review — see full proposal with research context
$ npm run cli proposals show abc12345

# Step 3: Decide — approve or reject
$ npm run cli proposals approve abc12345
# or
$ npm run cli proposals reject abc12345 --reason "Insufficient momentum"

# Browse all proposals
$ npm run cli proposals list
$ npm run cli proposals list --status proposed
```

## Design Principles

- **Honest about limitations**: The workflow never hides missing data. Proposals
  are explicitly capped, caveated, and annotated when research is incomplete.
- **Human-in-the-loop**: Proposals are always in "proposed" status. A human must
  explicitly approve before any future execution step.
- **Thin orchestration**: `analyzeSymbol()` composes existing services (research,
  proposal, persistence) without introducing new abstractions. Each service
  remains independently usable.
- **Graceful degradation**: The pipeline completes even when data sources fail.
  Missing data reduces confidence rather than blocking the workflow.

## Current Limits

- Auto-draft proposals use simple heuristics, not real investment analysis.
- The `analyze` command is a starting point — a real agent would use the
  underlying services with domain-specific logic.
- No execution layer yet. Approved proposals are tracked but not routed
  to a trading engine.
- News data may be unavailable without provider API keys.

## Programmatic Use

The workflow is also available as a function for integration:

```typescript
import { analyzeSymbol } from "./services/workflow";

const result = await analyzeSymbol({ symbol: "AAPL" });
// result.intent — the saved TradeIntent (or null)
// result.research — full ResearchSnapshot
// result.proposal — ProposalResult with data quality
// result.shortId — short ID for CLI reference
```
