import { formatArchRecap } from './recap.js';
import type { SpokenMessage } from './channel.js';
import type { Dispatcher } from './dispatch.js';
import type { RecapSnapshot } from './recapSnapshot.js';
import type { ArchSummary } from './summary.js';

export const NO_RECAP_LINE = 'No architectural recap is available yet.';

const LEADING_MARKER_RE = /^(?:#{1,6}|[-*+>]|\d+\.)(?:\s+|$)/;

export function shapePullRecap(input: {
  summary: ArchSummary;
  finalMessage: string | null;
}): SpokenMessage {
  const narration = flattenFinalMessage(input.finalMessage);
  const clauses = moatClauses(input.summary);
  const flagsText = clauses.join(', ');

  if (narration !== null && clauses.length > 0) {
    return { kind: 'spoken', text: `${narration} Familiar flagged ${flagsText}.` };
  }

  if (narration !== null) {
    return { kind: 'spoken', text: `${narration} Familiar flagged no architectural concerns.` };
  }

  if (clauses.length > 0) {
    return { kind: 'spoken', text: `Run landed: ${flagsText}.` };
  }

  return { kind: 'spoken', text: 'Run landed. No architectural changes.' };
}

export interface PullRecapDeps {
  loadSnapshot(): RecapSnapshot | null;
  dispatch: Dispatcher;
  emit?(text: string): void;
}

export function createPullRecap(deps: PullRecapDeps): () => void {
  return (): void => {
    const snapshot = deps.loadSnapshot();

    if (snapshot === null) {
      deps.dispatch('audio', { kind: 'spoken', text: NO_RECAP_LINE });
      deps.emit?.(NO_RECAP_LINE);
      return;
    }

    const message = shapePullRecap({
      summary: snapshot.summary,
      finalMessage: snapshot.finalMessage,
    });
    deps.dispatch('audio', message);
    deps.emit?.(formatArchRecap(snapshot.summary));
  };
}

function flattenFinalMessage(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const flattened = raw
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_MARKER_RE, '');

  return flattened === '' ? null : flattened;
}

function moatClauses(summary: ArchSummary): string[] {
  const violations = summary.violations.length;
  const protectedHits = summary.protectedHits.length;
  const modules = summary.modules.length;
  const newCouplings = summary.newCouplings.length;
  const clauses: string[] = [];

  if (violations > 0) {
    clauses.push(`${violations} boundary violation${violations === 1 ? '' : 's'}`);
  }

  if (protectedHits > 0) {
    clauses.push(`${protectedHits} protected zone${protectedHits === 1 ? '' : 's'} touched`);
  }

  if (modules > 0) {
    clauses.push(`${modules} module${modules === 1 ? '' : 's'} changed`);
  }

  if (newCouplings > 0) {
    clauses.push(`${newCouplings} new cross-module coupling${newCouplings === 1 ? '' : 's'}`);
  }

  return clauses;
}
