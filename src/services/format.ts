/**
 * CLI formatting for TradeIntent proposals.
 *
 * Produces a readable, structured terminal representation of a proposal.
 */

import type { TradeIntent } from "../types/trade-intent";

/** Format a single TradeIntent for terminal display. */
export function formatProposal(intent: TradeIntent, opts?: { showId?: boolean; usedFallbackData?: boolean }): string {
  const lines: string[] = [];
  const showId = opts?.showId ?? true;

  const dir = intent.direction.toUpperCase();
  const price =
    intent.order_type === "limit" && intent.limit_price != null
      ? `LIMIT @ $${intent.limit_price}`
      : "MARKET";

  lines.push(`┌─ Trade Proposal ──────────────────────────────`);
  lines.push(`│ ${dir} ${intent.asset}  ×${intent.quantity}  ${price}`);
  lines.push(`│`);

  if (intent.stop_loss != null || intent.take_profit != null) {
    const sl = intent.stop_loss != null ? `SL $${intent.stop_loss}` : "—";
    const tp = intent.take_profit != null ? `TP $${intent.take_profit}` : "—";
    lines.push(`│ Risk:       ${sl}  /  ${tp}`);
  }

  lines.push(`│ Horizon:    ${intent.time_horizon}    Position: ${intent.max_position_pct}% max`);
  lines.push(`│ Confidence: ${intent.confidence.toUpperCase()}`);
  lines.push(`│ Status:     ${intent.status}`);
  if (opts?.usedFallbackData != null) {
    const src = opts.usedFallbackData ? "FALLBACK (sample data)" : "LIVE";
    lines.push(`│ Data:       ${src}`);
  }
  lines.push(`│`);
  lines.push(`│ Thesis:`);
  // Wrap thesis to ~60 chars per line
  for (const chunk of wrapText(intent.thesis, 60)) {
    lines.push(`│   ${chunk}`);
  }

  if (intent.key_factors.length > 0) {
    lines.push(`│`);
    lines.push(`│ Supporting factors:`);
    for (const f of intent.key_factors) {
      lines.push(`│   + ${f}`);
    }
  }

  if (intent.key_risks.length > 0) {
    lines.push(`│`);
    lines.push(`│ Risks:`);
    for (const r of intent.key_risks) {
      lines.push(`│   - ${r}`);
    }
  }

  if (showId) {
    lines.push(`│`);
    lines.push(`│ ID: ${intent.id}`);
    lines.push(`│ Created: ${intent.timestamp}`);
  }

  lines.push(`└────────────────────────────────────────────────`);

  return lines.join("\n");
}

/** Format a list of proposals as a summary table. */
export function formatProposalList(intents: TradeIntent[]): string {
  if (intents.length === 0) return "No saved proposals.";

  const lines: string[] = [];
  lines.push(`  ${"Asset".padEnd(10)} ${"Dir".padEnd(6)} ${"Qty".padEnd(8)} ${"Conf".padEnd(7)} ${"Status".padEnd(10)} Created`);
  lines.push(`  ${"─".repeat(10)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(7)} ${"─".repeat(10)} ${"─".repeat(20)}`);

  for (const i of intents) {
    const created = i.timestamp.slice(0, 16).replace("T", " ");
    lines.push(
      `  ${i.asset.padEnd(10)} ${i.direction.padEnd(6)} ${String(i.quantity).padEnd(8)} ${i.confidence.padEnd(7)} ${i.status.padEnd(10)} ${created}`,
    );
  }

  return lines.join("\n");
}

function wrapText(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
