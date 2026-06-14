import { condenseFinalMessage } from './condense.js';
import { localizedRecapLine } from './recapLang.js';
import type { RecapLang } from './recapLang.js';
import type { ArchSummary } from './summary.js';

export interface ShapedRecap {
  kind: 'shaped-recap';
  spokenLine: string;
}

export function shapeRecap(input: {
  summary: ArchSummary;
  finalMessage?: string | null;
  subagentCount?: number;
  lang?: RecapLang;
}): ShapedRecap {
  const lang = input.lang;
  if (lang === 'es' || lang === 'fr' || lang === 'de' || lang === 'ja') {
    return {
      kind: 'shaped-recap',
      spokenLine: localizedRecapLine({
        summary: input.summary,
        subagentCount: input.subagentCount,
        lang,
      }),
    };
  }

  const gist = condenseFinalMessage(input.finalMessage ?? null);
  const baseLine = gist === null
    ? deterministicLine(input.summary)
    : blendedLine(input.summary, gist);

  return {
    kind: 'shaped-recap',
    spokenLine: appendSubagentCount(baseLine, input.subagentCount),
  };
}

function appendSubagentCount(line: string, subagentCount: number | undefined): string {
  if (
    typeof subagentCount !== 'number' ||
    !Number.isInteger(subagentCount) ||
    subagentCount <= 0
  ) {
    return line;
  }

  return `${line} ${subagentCount} subagent${subagentCount === 1 ? '' : 's'} finished.`;
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
