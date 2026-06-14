import { describe, it, expect } from 'vitest';
import { shapeRecap } from '../src/shaper.js';
import { localizedRecapLine } from '../src/recapLang.js';
import type { ArchSummary } from '../src/summary.js';

function buildSummary(v: number, p: number, m: number, c: number): ArchSummary {
  return {
    kind: 'arch-summary',
    violations: Array(v).fill(1),
    protectedHits: Array(p).fill(1),
    modules: Array(m).fill(1),
    newCouplings: Array(c).fill(1),
  };
}

describe('shaper (language additions)', () => {
  it('AC9: Target languages call localizedRecapLine and drop finalMessage', () => {
    const summary = buildSummary(1, 1, 1, 1);
    
    for (const lang of ['es', 'fr', 'de', 'ja'] as const) {
      const expectedLine = localizedRecapLine({ summary, subagentCount: 2, lang });
      
      const resultWithoutMessage = shapeRecap({ summary, subagentCount: 2, lang });
      expect(resultWithoutMessage).toEqual({
        kind: 'shaped-recap',
        spokenLine: expectedLine
      });

      const resultWithMessage = shapeRecap({ summary, subagentCount: 2, lang, finalMessage: 'Some english gist' });
      expect(resultWithMessage).toEqual({
        kind: 'shaped-recap',
        spokenLine: expectedLine
      });
    }
  });

  it('AC10: Missing lang or "en" returns byte-identical existing behavior', () => {
    const summary = buildSummary(1, 1, 1, 1);
    
    const resultDefault = shapeRecap({ summary, finalMessage: 'Gist' });
    const resultEn = shapeRecap({ summary, finalMessage: 'Gist', lang: 'en' });
    
    expect(resultEn).toEqual(resultDefault);
  });

  it('AC11: shapeRecap never throws', () => {
    const summary = buildSummary(0, 0, 0, 0);
    expect(() => shapeRecap({ summary, lang: 'es' })).not.toThrow();
    expect(() => shapeRecap({ summary, lang: 'en' })).not.toThrow();
    expect(() => shapeRecap({ summary })).not.toThrow();
  });
});
