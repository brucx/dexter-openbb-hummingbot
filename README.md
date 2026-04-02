# dexter-openbb-hummingbot

An integration architecture connecting [Dexter](https://github.com/virattt/dexter) (AI research agent), [OpenBB](https://github.com/OpenBB-finance/OpenBB) (market data platform), and [Hummingbot](https://github.com/hummingbot/hummingbot) (trading execution framework) into a coherent research-to-execution pipeline with human oversight at every stage.

## Vision

Most AI trading projects skip straight to autonomous execution. This project takes a different approach: build a **research-first pipeline** where an AI agent can analyze markets deeply, propose trade ideas with full reasoning, and — only with explicit human approval — execute them in a paper trading environment.

The goal is not to build an autonomous trading bot. It is to build a **human-augmented research and execution workflow** where the AI does the heavy lifting on analysis and the human retains full control over capital decisions.

## How the pieces fit together

```
┌─────────────────────────────────────────────────────────┐
│  Dexter (Orchestration + Research Agent)                │
│  - Decomposes research questions into multi-step plans  │
│  - Calls tools, synthesizes findings, proposes actions  │
│  - Generates structured TradeIntent proposals           │
├─────────────────────────────────────────────────────────┤
│  OpenBB (Market Data + Research Tools)                  │
│  - Unified API across 30+ data providers                │
│  - Equity, crypto, macro, options, news                 │
│  - Technical analysis, quantitative tools               │
├─────────────────────────────────────────────────────────┤
│  Human Approval Gate                                    │
│  - Reviews trade proposals with full reasoning chain    │
│  - Approves, rejects, or modifies before execution      │
│  - Configurable risk limits and position constraints     │
├─────────────────────────────────────────────────────────┤
│  Hummingbot (Execution Layer — Paper Trading Only)      │
│  - Paper trade connectors with real market data          │
│  - Order placement, tracking, and event reporting        │
│  - Position and balance management                       │
└─────────────────────────────────────────────────────────┘
```

## Scope

**In scope:**
- Dexter as the AI research agent, using its existing LangChain-based agent loop
- OpenBB as a tool provider for market data, fundamentals, and analysis
- Hummingbot paper trading connectors for simulated execution
- A human approval layer between research output and trade execution
- Structured trade intent format for machine-readable proposals
- CLI-based workflow for the initial implementation

**Out of scope (and staying that way):**
- Autonomous real-money trading
- High-frequency or latency-sensitive strategies
- Portfolio management or rebalancing automation
- Social trading, copy trading, or multi-user features
- Mobile or web UI (CLI first, always)

## Non-goals

This project will **not**:
- Execute trades without explicit human approval
- Connect to live exchange accounts with real funds
- Attempt to "beat the market" or promise returns
- Replace human judgment with AI judgment on capital allocation
- Become a product — this is a prototype and learning tool

## Project status

**Phase 0** — Documentation and scaffolding. See [docs/PLAN.md](docs/PLAN.md) for the full roadmap.

## Getting started

Prerequisites:
- [Bun](https://bun.sh) (for Dexter, TypeScript runtime)
- Python 3.10+ (for OpenBB and Hummingbot)
- API keys for at least one LLM provider and one data provider

```bash
# Clone with submodule references
git clone <this-repo>

# See the plan
cat docs/PLAN.md

# Copy and edit config
cp config/example.env .env
```

Detailed setup instructions will be added as each phase is implemented.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design and integration points
- [Implementation Plan](docs/PLAN.md) — Phased roadmap
- [Engineering Tasks](docs/TASKS.md) — Concrete work items by phase

## License

MIT
