import type { ArchSummary } from './summary.js';

export interface ShapedRecap {
  kind: 'shaped-recap';
  spokenLine: string;
}

export interface SummarizerInput {
  summary: ArchSummary;
  finalMessage: string | null;
}

export interface Summarizer {
  summarize(input: SummarizerInput): string | null;
}

export function shapeRecap(input: {
  summary: ArchSummary;
  finalMessage?: string | null;
  summarizer?: Summarizer;
}): ShapedRecap {
  const finalMessage = input.finalMessage ?? null;
  const summarizedLine = summarize(input.summary, finalMessage, input.summarizer);

  return {
    kind: 'shaped-recap',
    spokenLine: summarizedLine ?? deterministicLine(input.summary),
  };
}

function summarize(
  summary: ArchSummary,
  finalMessage: string | null,
  summarizer?: Summarizer,
): string | null {
  if (summarizer === undefined) {
    return null;
  }

  try {
    const line = summarizer.summarize({ summary, finalMessage });

    return typeof line === 'string' && line.trim() !== ''
      ? line
      : null;
  } catch {
    return null;
  }
}

function deterministicLine(summary: ArchSummary): string {
  const v = summary.violations.length;
  const p = summary.protectedHits.length;
  const m = summary.modules.length;
  const c = summary.newCouplings.length;

  if (v === 0 && p === 0 && m === 0 && c === 0) {
    return 'Run landed. No architectural changes.';
  }

  return `Run landed: ${[
    v > 0 ? `${v} boundary violation${v === 1 ? '' : 's'}` : null,
    p > 0 ? `${p} protected zone${p === 1 ? '' : 's'} touched` : null,
    m > 0 ? `${m} module${m === 1 ? '' : 's'} changed` : null,
    c > 0 ? `${c} new cross-module coupling${c === 1 ? '' : 's'}` : null,
  ].filter((clause): clause is string => clause !== null).join(', ')}.`;
}
