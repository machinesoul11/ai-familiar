import type { SpokenMessage } from './channel.js';
import type { Dispatcher } from './dispatch.js';
import type { LedgerRow } from './ledger.js';

export interface AwayRollup {
  kind: 'away-rollup';
  sessionCount: number;
  runsLanded: number;
  subagentsFinished: number;
  needsYou: number;
}

export function buildAwayRollup(rows: LedgerRow[]): AwayRollup {
  const sessions = new Set<string>();
  let runsLanded = 0;
  let subagentsFinished = 0;
  let needsYou = 0;

  for (const row of rows) {
    sessions.add(row.sessionId);

    if (row.kind === 'run-finished') {
      runsLanded++;
    }

    if (row.kind === 'subagent-finished') {
      subagentsFinished++;
    }

    if (row.reason === 'needs-permission' || row.reason === 'needs-input') {
      needsYou++;
    }
  }

  return {
    kind: 'away-rollup',
    sessionCount: sessions.size,
    runsLanded,
    subagentsFinished,
    needsYou,
  };
}

export function shapeAwayRollup(rollup: AwayRollup): SpokenMessage {
  const clauses: string[] = [];

  if (rollup.sessionCount > 1) {
    clauses.push(`${rollup.sessionCount} sessions`);
  }

  if (rollup.needsYou > 0) {
    clauses.push(`${rollup.needsYou} needs-you moment${rollup.needsYou === 1 ? '' : 's'}`);
  }

  if (rollup.runsLanded > 0) {
    clauses.push(`${rollup.runsLanded} run${rollup.runsLanded === 1 ? '' : 's'} landed`);
  }

  if (rollup.subagentsFinished > 0) {
    clauses.push(`${rollup.subagentsFinished} subagent${rollup.subagentsFinished === 1 ? '' : 's'} finished`);
  }

  if (clauses.length === 0) {
    return { kind: 'spoken', text: 'While you were away: nothing to report.' };
  }

  return { kind: 'spoken', text: `While you were away: ${clauses.join(', ')}.` };
}

export interface RecallDeps {
  loadRows(): LedgerRow[];
  dispatch: Dispatcher;
  emit?(text: string): void;
  onSpoken?(message: SpokenMessage): void;
}

export function createRecall(deps: RecallDeps): () => void {
  return (): void => {
    const rows = deps.loadRows();
    const message = shapeAwayRollup(buildAwayRollup(rows));
    deps.dispatch('audio', message);
    deps.onSpoken?.(message);
    deps.emit?.(message.text);
  };
}
