import type { ArchSummary } from './summary.js';

export interface RecapSnapshot {
  v: 1;
  summary: ArchSummary;
  finalMessage: string | null;
}

export function serializeSnapshot(snapshot: RecapSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseSnapshot(raw: string | null): RecapSnapshot | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || parsed.v !== 1) {
    return null;
  }

  const summary = parsed.summary;
  if (
    !isPlainObject(summary)
    || summary.kind !== 'arch-summary'
    || !Array.isArray(summary.modules)
    || !Array.isArray(summary.newCouplings)
    || !Array.isArray(summary.protectedHits)
    || !Array.isArray(summary.violations)
  ) {
    return null;
  }

  const finalMessage = typeof parsed.finalMessage === 'string' ? parsed.finalMessage : null;

  return { v: 1, summary: summary as unknown as ArchSummary, finalMessage };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
