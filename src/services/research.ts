/**
 * ResearchService — high-level API for querying market data through the OpenBB bridge.
 *
 * This normalizes bridge responses into a consistent shape and provides
 * convenience methods for common research workflows.
 */

import { BridgeClient } from "../bridge/bridge-client";
import type { OpenBBResponse } from "../types/bridge-protocol";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_BRIDGE_PATH = join(__dirname, "..", "bridge", "openbb_bridge.py");

// ---------------------------------------------------------------------------
// Normalized response types
// ---------------------------------------------------------------------------

export interface QuoteData {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  marketCap?: number;
  peRatio?: number;
  isFallback: boolean;
}

export interface PriceRecord {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistoryData {
  symbol: string;
  records: PriceRecord[];
  isFallback: boolean;
}

export interface FinancialsData {
  symbol: string;
  period: string;
  incomeStatement: Record<string, unknown>;
  balanceSheet?: Record<string, unknown>;
  isFallback: boolean;
}

export interface NewsArticle {
  title: string;
  source?: string;
  date?: string;
  summary?: string;
  url?: string;
}

export interface NewsData {
  symbol: string;
  articles: NewsArticle[];
  isFallback: boolean;
}

/** Combined research snapshot for a single asset. */
export interface ResearchSnapshot {
  symbol: string;
  quote: QuoteData | null;
  priceHistory: PriceHistoryData | null;
  financials: FinancialsData | null;
  news: NewsData | null;
  errors: string[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ResearchService {
  private client: BridgeClient;
  private _started = false;

  constructor(options?: { bridgePath?: string; pythonBin?: string; env?: Record<string, string> }) {
    this.client = new BridgeClient({
      scriptPath: options?.bridgePath ?? DEFAULT_BRIDGE_PATH,
      pythonBin: options?.pythonBin,
      env: options?.env,
    });
  }

  /** Start the underlying bridge. Call once before making requests. */
  start(): void {
    if (this._started) return;
    this.client.start();
    this._started = true;
  }

  /** Stop the bridge. */
  stop(): void {
    this.client.stop();
    this._started = false;
  }

  // -- Individual queries --------------------------------------------------

  async getQuote(symbol: string): Promise<QuoteData> {
    const resp = await this.client.request("quote", { symbol });
    this._throwIfError(resp);
    const d = resp.data as Record<string, unknown>;
    return {
      symbol: (d.symbol as string) ?? symbol,
      name: d.name as string | undefined,
      price: Number(d.price ?? d.last_price ?? 0),
      change: Number(d.change ?? 0),
      changePct: Number(d.change_percent ?? d.change_pct ?? 0),
      volume: Number(d.volume ?? 0),
      marketCap: d.market_cap != null ? Number(d.market_cap) : undefined,
      peRatio: d.pe_ratio != null ? Number(d.pe_ratio) : undefined,
      isFallback: Boolean(d._fallback),
    };
  }

  async getPriceHistory(symbol: string, days = 30): Promise<PriceHistoryData> {
    const resp = await this.client.request("price_history", { symbol, days });
    this._throwIfError(resp);
    const d = resp.data as Record<string, unknown>;
    const raw = (d.records as Record<string, unknown>[]) ?? [];
    return {
      symbol,
      records: raw.map((r) => ({
        date: String(r.date ?? ""),
        open: Number(r.open ?? 0),
        high: Number(r.high ?? 0),
        low: Number(r.low ?? 0),
        close: Number(r.close ?? 0),
        volume: Number(r.volume ?? 0),
      })),
      isFallback: Boolean(d._fallback),
    };
  }

  async getFinancials(symbol: string, period = "annual"): Promise<FinancialsData> {
    const resp = await this.client.request("financials", { symbol, period });
    this._throwIfError(resp);
    const d = resp.data as Record<string, unknown>;
    return {
      symbol,
      period: (d.period as string) ?? period,
      incomeStatement: (d.income_statement as Record<string, unknown>) ?? {},
      balanceSheet: d.balance_sheet as Record<string, unknown> | undefined,
      isFallback: Boolean(d._fallback),
    };
  }

  async getNews(symbol: string, limit = 5): Promise<NewsData> {
    const resp = await this.client.request("news", { symbol, limit });
    this._throwIfError(resp);
    const d = resp.data as Record<string, unknown>;
    const raw = (d.articles as Record<string, unknown>[]) ?? [];
    return {
      symbol,
      articles: raw.map((a) => ({
        title: String(a.title ?? ""),
        source: a.source as string | undefined,
        date: a.date as string | undefined,
        summary: a.summary as string | undefined,
        url: a.url as string | undefined,
      })),
      isFallback: Boolean(d._fallback),
    };
  }

  // -- Combined research ---------------------------------------------------

  /**
   * Run a full research snapshot for a symbol.
   * Calls quote, price_history, financials, and news in parallel.
   * Individual failures are captured in `errors` — the snapshot still returns
   * whatever data succeeded.
   */
  async research(symbol: string): Promise<ResearchSnapshot> {
    const errors: string[] = [];
    const results = await Promise.allSettled([
      this.getQuote(symbol),
      this.getPriceHistory(symbol),
      this.getFinancials(symbol),
      this.getNews(symbol),
    ]);

    const get = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
      if (r.status === "fulfilled") return r.value;
      errors.push(`${label}: ${(r.reason as Error).message}`);
      return null;
    };

    return {
      symbol,
      quote: get(results[0]!, "quote"),
      priceHistory: get(results[1]!, "priceHistory"),
      financials: get(results[2]!, "financials"),
      news: get(results[3]!, "news"),
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  private _throwIfError(resp: OpenBBResponse): void {
    if (resp.error) {
      throw new Error(`Bridge error: ${resp.error}`);
    }
  }
}
