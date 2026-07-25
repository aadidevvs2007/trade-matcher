import { InvestigateBreakResult, ResolveOrEscalateResult, AccuracyStats } from './resolve.types';

// This counter lives in memory while the server runs.
// Good enough for a hackathon demo — no database needed.
const stats: AccuracyStats = {
  totalProcessed: 0,
  resolvedCount: 0,
  escalatedCount: 0,
};

/**
 * Takes the output of investigate_break and decides: resolved or escalated.
 * explained: true  -> resolved (agent understood the break, no human needed)
 * explained: false -> escalated (flag for a human to review)
 */
export function resolveOrEscalate(
  input: InvestigateBreakResult,
): ResolveOrEscalateResult {
  const status: 'resolved' | 'escalated' = input.explained
    ? 'resolved'
    : 'escalated';

  // update the running counter
  stats.totalProcessed += 1;
  if (status === 'resolved') {
    stats.resolvedCount += 1;
  } else {
    stats.escalatedCount += 1;
  }

  return {
    breakId: input.breakId,
    status,
    reason: input.reason,
    confidence: input.confidence,
  };
}

/**
 * Returns the current running totals — the dashboard (Agastya's part)
 * can call this to show "X resolved / Y escalated" live during the demo.
 */
export function getAccuracyStats(): AccuracyStats {
  return { ...stats };
}