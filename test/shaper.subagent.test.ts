import { describe, it, expect } from 'vitest';
import { shapeRecap } from '../src/shaper.js';
import type { ArchSummary } from '../src/summary.js';

describe('shaper with subagentCount', () => {
  const emptySummary: ArchSummary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] };
  const detSummary: ArchSummary = { kind: 'arch-summary', modules: [1, 2], newCouplings: [], protectedHits: [], violations: [] };
  const blendedSummary: ArchSummary = { kind: 'arch-summary', modules: [1, 2], newCouplings: [], protectedHits: [], violations: [1] };

  it('AC8: omitted / undefined / 0 / negative / non-integer / NaN -> byte-identical', () => {
    const baseEmpty = shapeRecap({ summary: emptySummary });
    const baseDet = shapeRecap({ summary: detSummary });
    const baseBlended = shapeRecap({ summary: blendedSummary, finalMessage: 'A gist.' });

    const invalids = [undefined, 0, -1, 2.5, NaN];
    for (const invalid of invalids) {
      expect(shapeRecap({ summary: emptySummary, subagentCount: invalid })).toEqual(baseEmpty);
      expect(shapeRecap({ summary: detSummary, subagentCount: invalid })).toEqual(baseDet);
      expect(shapeRecap({ summary: blendedSummary, finalMessage: 'A gist.', subagentCount: invalid })).toEqual(baseBlended);
    }
  });

  it('AC9: positive integer appends subagent(s) string to all paths', () => {
    const emptyBase = shapeRecap({ summary: emptySummary }).spokenLine;
    expect(shapeRecap({ summary: emptySummary, subagentCount: 1 }).spokenLine).toBe(`${emptyBase} 1 subagent finished.`);
    expect(shapeRecap({ summary: emptySummary, subagentCount: 3 }).spokenLine).toBe(`${emptyBase} 3 subagents finished.`);

    const detBase = shapeRecap({ summary: detSummary }).spokenLine;
    expect(shapeRecap({ summary: detSummary, subagentCount: 1 }).spokenLine).toBe(`${detBase} 1 subagent finished.`);
    expect(shapeRecap({ summary: detSummary, subagentCount: 3 }).spokenLine).toBe(`${detBase} 3 subagents finished.`);

    const blendedBase = shapeRecap({ summary: blendedSummary, finalMessage: 'A gist.' }).spokenLine;
    expect(shapeRecap({ summary: blendedSummary, finalMessage: 'A gist.', subagentCount: 1 }).spokenLine).toBe(`${blendedBase} 1 subagent finished.`);
    expect(shapeRecap({ summary: blendedSummary, finalMessage: 'A gist.', subagentCount: 3 }).spokenLine).toBe(`${blendedBase} 3 subagents finished.`);
  });

  it('AC10: kind stays shaped-recap and never throws', () => {
    expect(() => shapeRecap({ summary: emptySummary })).not.toThrow();
    const res = shapeRecap({ summary: emptySummary, subagentCount: 2 });
    expect(res.kind).toBe('shaped-recap');
  });
});
