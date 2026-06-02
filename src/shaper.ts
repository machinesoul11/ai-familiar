import { condenseFinalMessage } from './condense.js';
import type { ArchSummary } from './summary.js';

export interface ShapedRecap {
  kind: 'shaped-recap';
  spokenLine: string;
}

export function shapeRecap(input: {
  summary: ArchSummary;
  finalMessage?: string | null;
}): ShapedRecap {
  const gist = condenseFinalMessage(input.finalMessage ?? null);

  return {
    kind: 'shaped-recap',
    spokenLine: gist === null
      ? deterministicLine(input.summary)
      : blendedLine(input.summary, gist),
  };
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

function blendedLine(summary: ArchSummary, gist: string): string {
  const v = summary.violations.length;
  const p = summary.protectedHits.length;
  const c = summary.newCouplings.length;
  const concerns = [
    v > 0 ? `${v} boundary violation${v === 1 ? '' : 's'}` : null,
    p > 0 ? `${p} protected zone${p === 1 ? '' : 's'} touched` : null,
    c > 0 ? `${c} new cross-module coupling${c === 1 ? '' : 's'}` : null,
  ].filter((clause): clause is string => clause !== null);

  if (concerns.length === 0) {
    return gist;
  }

  return `${gist} Familiar flagged ${concerns.join(', ')}.`;
}
