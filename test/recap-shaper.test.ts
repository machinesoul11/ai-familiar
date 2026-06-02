import { describe, it, expect, vi } from 'vitest';
import { shapeRecap, type ShapedRecap, type Summarizer, type SummarizerInput } from '../src/shaper.js';
import type { ArchSummary } from '../src/summary.js';

// Helper to create stubs for ArchSummary with specific counts
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
  // AC 1: Empty summary, no summarizer
  it('should return "Run landed. No architectural changes." for empty summary', () => {
    const summary = createSummary(0, 0, 0, 0);
    const result = shapeRecap({ summary });
    expect(result.kind).toBe('shaped-recap');
    expect(result.spokenLine).toBe('Run landed. No architectural changes.');
  });

  // AC 2 & 4: Modules-only (m=3)
  it('should handle modules-only summary (plural)', () => {
    const summary = createSummary(0, 0, 3, 0);
    const result = shapeRecap({ summary });
    expect(result.spokenLine).toBe('Run landed: 3 modules changed.');
  });

  // AC 3: Singular forms
  it('should use singular forms for single counts', () => {
    expect(shapeRecap({ summary: createSummary(1, 0, 0, 0) }).spokenLine).toBe('Run landed: 1 boundary violation.');
    expect(shapeRecap({ summary: createSummary(0, 1, 0, 0) }).spokenLine).toBe('Run landed: 1 protected zone touched.');
    expect(shapeRecap({ summary: createSummary(0, 0, 1, 0) }).spokenLine).toBe('Run landed: 1 module changed.');
    expect(shapeRecap({ summary: createSummary(0, 0, 0, 1) }).spokenLine).toBe('Run landed: 1 new cross-module coupling.');
  });

  // AC 4: Plural forms
  it('should use plural forms for multiple counts', () => {
    expect(shapeRecap({ summary: createSummary(2, 0, 0, 0) }).spokenLine).toBe('Run landed: 2 boundary violations.');
    expect(shapeRecap({ summary: createSummary(0, 2, 0, 0) }).spokenLine).toBe('Run landed: 2 protected zones touched.');
    expect(shapeRecap({ summary: createSummary(0, 0, 2, 0) }).spokenLine).toBe('Run landed: 2 modules changed.');
    expect(shapeRecap({ summary: createSummary(0, 0, 0, 2) }).spokenLine).toBe('Run landed: 2 new cross-module couplings.');
  });

  // AC 5 & 6: Full-mix order+join and non-empty clauses
  it('should handle full-mix order and joining correctly', () => {
    // v=1, p=2, m=4, c=1
    const summary = createSummary(1, 2, 4, 1);
    const result = shapeRecap({ summary });
    expect(result.spokenLine).toBe('Run landed: 1 boundary violation, 2 protected zones touched, 4 modules changed, 1 new cross-module coupling.');
  });

  it('should only include non-empty clauses in correct order', () => {
    // v=2, m=1 (no protected/couplings)
    const summary = createSummary(2, 0, 1, 0);
    const result = shapeRecap({ summary });
    expect(result.spokenLine).toBe('Run landed: 2 boundary violations, 1 module changed.');
  });

  // AC 7: finalMessage ignored by deterministic path
  it('should ignore finalMessage in deterministic path', () => {
    const summary = createSummary(1, 0, 0, 0);
    const expected = 'Run landed: 1 boundary violation.';
    expect(shapeRecap({ summary, finalMessage: 'something' }).spokenLine).toBe(expected);
    expect(shapeRecap({ summary, finalMessage: null }).spokenLine).toBe(expected);
    expect(shapeRecap({ summary, finalMessage: '' }).spokenLine).toBe(expected);
  });

  // AC 8: Summarizer returning a non-empty string
  it('should use non-empty string from summarizer verbatim', () => {
    const summary = createSummary(1, 1, 1, 1);
    const finalMessage = 'Custom message';
    const summarizer: Summarizer = {
      summarize: vi.fn().mockReturnValue('Verbatim custom output ')
    };
    const result = shapeRecap({ summary, finalMessage, summarizer });
    expect(result.spokenLine).toBe('Verbatim custom output ');
    expect(summarizer.summarize).toHaveBeenCalledWith({ summary, finalMessage });
  });

  it('should default finalMessage to null when omitted and calling summarizer', () => {
    const summary = createSummary(0, 0, 0, 0);
    const summarizer: Summarizer = {
      summarize: vi.fn().mockReturnValue('custom')
    };
    shapeRecap({ summary, summarizer });
    expect(summarizer.summarize).toHaveBeenCalledWith({ summary, finalMessage: null });
  });

  // AC 9: Summarizer returning null / '' / whitespace-only / a non-string
  it('should fall back if summarizer returns null, empty, or whitespace', () => {
    const summary = createSummary(1, 0, 0, 0);
    const expected = 'Run landed: 1 boundary violation.';
    
    expect(shapeRecap({ summary, summarizer: { summarize: () => null } }).spokenLine).toBe(expected);
    expect(shapeRecap({ summary, summarizer: { summarize: () => '' } }).spokenLine).toBe(expected);
    expect(shapeRecap({ summary, summarizer: { summarize: () => '   ' } }).spokenLine).toBe(expected);
    // @ts-expect-error - testing non-string return for robustness
    expect(shapeRecap({ summary, summarizer: { summarize: () => 123 } }).spokenLine).toBe(expected);
  });

  // AC 10: Summarizer that throws
  it('should fall back if summarizer throws', () => {
    const summary = createSummary(0, 0, 1, 0);
    const summarizer: Summarizer = {
      summarize: () => { throw new Error('fail'); }
    };
    const result = shapeRecap({ summary, summarizer });
    expect(result.spokenLine).toBe('Run landed: 1 module changed.');
  });

  // AC 11: Determinism
  it('should be deterministic', () => {
    const summary = createSummary(1, 1, 1, 1);
    const result1 = shapeRecap({ summary });
    const result2 = shapeRecap({ summary });
    expect(result1).toEqual(result2);
  });

  // AC 12: kind is always 'shaped-recap'
  it('should always return kind "shaped-recap"', () => {
    expect(shapeRecap({ summary: createSummary() }).kind).toBe('shaped-recap');
    expect(shapeRecap({ summary: createSummary(1, 1, 1, 1), summarizer: { summarize: () => 'custom' } }).kind).toBe('shaped-recap');
  });
});
