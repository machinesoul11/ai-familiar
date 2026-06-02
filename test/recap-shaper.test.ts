import { describe, it, expect } from 'vitest';
import { shapeRecap, type ShapedRecap } from '../src/shaper.js';
import type { ArchSummary } from '../src/summary.js';

const createSummary = (v = 0, p = 0, m = 0, c = 0): ArchSummary => ({
  kind: 'arch-summary',
  violations: Array(v).fill({
    fromModule: 'a',
    toModule: 'b',
    fromFile: 'a/x.ts',
    specifier: 'b',
    rule: { from: 'a', to: 'b', name: 'a-no-b' }
  }),
  protectedHits: Array(p).fill({
    path: 'src/x.ts',
    status: 'modified',
    pattern: 'src/x.ts'
  }),
  modules: Array(m).fill({
    module: 'src',
    files: [],
    added: 1,
    modified: 0,
    deleted: 0,
    renamed: 0
  }),
  newCouplings: Array(c).fill({
    fromModule: 'a',
    toModule: 'b',
    fromFile: 'a/x.ts',
    specifier: 'b'
  })
});

describe('shapeRecap', () => {
  // AC 9: Empty summary -> unchanged
  it('AC9: should return "Run landed. No architectural changes." for empty summary and no finalMessage', () => {
    const summary = createSummary(0, 0, 0, 0);
    expect(shapeRecap({ summary }).spokenLine).toBe('Run landed. No architectural changes.');
    expect(shapeRecap({ summary, finalMessage: null }).spokenLine).toBe('Run landed. No architectural changes.');
  });

  // AC 10: Modules-only -> unchanged
  it('AC10: should handle modules-only summary (plural) with no finalMessage', () => {
    const summary = createSummary(0, 0, 3, 0);
    expect(shapeRecap({ summary }).spokenLine).toBe('Run landed: 3 modules changed.');
  });

  // Singular forms (3.1 line)
  it('AC14: should use singular forms for single counts with no finalMessage', () => {
    expect(shapeRecap({ summary: createSummary(1, 0, 0, 0) }).spokenLine).toBe('Run landed: 1 boundary violation.');
    expect(shapeRecap({ summary: createSummary(0, 1, 0, 0) }).spokenLine).toBe('Run landed: 1 protected zone touched.');
    expect(shapeRecap({ summary: createSummary(0, 0, 1, 0) }).spokenLine).toBe('Run landed: 1 module changed.');
    expect(shapeRecap({ summary: createSummary(0, 0, 0, 1) }).spokenLine).toBe('Run landed: 1 new cross-module coupling.');
  });

  // Plural forms (3.1 line)
  it('AC14: should use plural forms for multiple counts with no finalMessage', () => {
    expect(shapeRecap({ summary: createSummary(2, 0, 0, 0) }).spokenLine).toBe('Run landed: 2 boundary violations.');
    expect(shapeRecap({ summary: createSummary(0, 2, 0, 0) }).spokenLine).toBe('Run landed: 2 protected zones touched.');
    expect(shapeRecap({ summary: createSummary(0, 0, 2, 0) }).spokenLine).toBe('Run landed: 2 modules changed.');
    expect(shapeRecap({ summary: createSummary(0, 0, 0, 2) }).spokenLine).toBe('Run landed: 2 new cross-module couplings.');
  });

  // Full mix (3.1 line)
  it('AC11: should handle full-mix order and joining correctly with no finalMessage', () => {
    const summary = createSummary(1, 2, 4, 1);
    expect(shapeRecap({ summary }).spokenLine).toBe('Run landed: 1 boundary violation, 2 protected zones touched, 4 modules changed, 1 new cross-module coupling.');
  });

  it('AC11: should only include non-empty clauses in correct order with no finalMessage', () => {
    const summary = createSummary(2, 0, 1, 0);
    expect(shapeRecap({ summary }).spokenLine).toBe('Run landed: 2 boundary violations, 1 module changed.');
  });

  // Gist present + no concerns
  it('AC12: should return gist exactly when finalMessage is present and no concerns exist', () => {
    const summary = createSummary(0, 0, 3, 0); // modules count does not count as a concern when gist is present
    const finalMessage = 'Refactored the parser.';
    expect(shapeRecap({ summary, finalMessage }).spokenLine).toBe('Refactored the parser.');
  });

  // Gist present + concerns
  it('AC13/14: should blend gist with concerns, omitting modules count', () => {
    const summary = createSummary(1, 2, 4, 0); // v=1, p=2, m=4, c=0
    const finalMessage = 'Added backlinks and tag indexing; all tests pass.';
    expect(shapeRecap({ summary, finalMessage }).spokenLine).toBe(
      'Added backlinks and tag indexing; all tests pass. Familiar flagged 1 boundary violation, 2 protected zones touched.'
    );
  });

  it('AC13/14: should blend gist with new couplings, omitting modules count', () => {
    const summary = createSummary(0, 0, 5, 1); // m=5, c=1
    const finalMessage = 'Some final message.';
    expect(shapeRecap({ summary, finalMessage }).spokenLine).toBe(
      'Some final message. Familiar flagged 1 new cross-module coupling.'
    );
  });

  // Whitespace-only finalMessage
  it('AC15: should treat whitespace-only finalMessage as no gist (deterministic line)', () => {
    const summary = createSummary(1, 0, 0, 0);
    expect(shapeRecap({ summary, finalMessage: '   ' }).spokenLine).toBe('Run landed: 1 boundary violation.');
    expect(shapeRecap({ summary, finalMessage: '\n\n' }).spokenLine).toBe('Run landed: 1 boundary violation.');
  });

  // Determinism and type
  it('AC16: should always return kind "shaped-recap", be deterministic, and not throw', () => {
    const summary = createSummary(1, 1, 1, 1);
    const finalMessage = 'Test message';
    
    expect(() => shapeRecap({ summary, finalMessage })).not.toThrow();
    
    const result = shapeRecap({ summary, finalMessage });
    expect(result.kind).toBe('shaped-recap');
    
    // Determinism
    expect(shapeRecap({ summary, finalMessage })).toEqual(result);
  });
});
