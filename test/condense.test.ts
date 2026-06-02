import { describe, it, expect } from 'vitest';
import { condenseFinalMessage, MAX_GIST_CHARS } from '../src/condense.js';

describe('condenseFinalMessage', () => {
  it('AC1: returns null for null or whitespace-only input', () => {
    expect(condenseFinalMessage(null)).toBeNull();
    expect(condenseFinalMessage('')).toBeNull();
    expect(condenseFinalMessage('   ')).toBeNull();
    expect(condenseFinalMessage('\n\n')).toBeNull();
  });

  it('AC2: returns short single-line message trimmed and verbatim', () => {
    expect(condenseFinalMessage('Added backlinks and tag indexing to the notes lib; all tests pass.')).toBe('Added backlinks and tag indexing to the notes lib; all tests pass.');
    expect(condenseFinalMessage('  Trim me  ')).toBe('Trim me');
  });

  it('AC3: strips leading markdown heading/bullet', () => {
    expect(condenseFinalMessage('## Summary\nAdded X.')).toBe('Summary Added X.');
    expect(condenseFinalMessage('- Added X.')).toBe('Added X.');
    expect(condenseFinalMessage('* Added X.')).toBe('Added X.');
    expect(condenseFinalMessage('> Added X.')).toBe('Added X.');
    expect(condenseFinalMessage('1. Added X.')).toBe('Added X.');
    expect(condenseFinalMessage('  ###   Added X.  ')).toBe('Added X.');
  });

  it('AC4: returns only the first block up to a blank line', () => {
    expect(condenseFinalMessage('Added backlinks.\n\n- detail one\n- detail two')).toBe('Added backlinks.');
    expect(condenseFinalMessage('First block.\n\n\nSecond block.')).toBe('First block.');
  });

  it('AC5: converts single newlines to spaces and collapses whitespace', () => {
    expect(condenseFinalMessage('Line one.\nLine two.   Word   ')).toBe('Line one. Line two. Word');
  });

  it('AC6: cuts over-cap input at last sentence terminator within cap, no ellipsis', () => {
    const sentence1 = "First sentence.";
    const sentence2 = "Second sentence!";
    const filler = " word".repeat(Math.floor(MAX_GIST_CHARS / 5) + 10);
    const input = `${sentence1} ${sentence2}${filler}`;
    // It is longer than MAX_GIST_CHARS. The last terminator is '!'.
    const result = condenseFinalMessage(input);
    expect(result).toBe(`${sentence1} ${sentence2}`);
  });

  it('AC7: cuts over-cap input with no terminator in-window at last space + ellipsis', () => {
    const part1 = "a".repeat(MAX_GIST_CHARS - 10);
    const part2 = "bbbbbbbbbbbbbbbbbbbb"; // 20 'b's
    const input = `${part1} ${part2}`;
    const result = condenseFinalMessage(input);
    expect(result).toBe(`${part1}…`);
  });

  it('AC8: normalizes \\r\\n, is deterministic, never throws', () => {
    expect(condenseFinalMessage('Line 1\r\nLine 2\r\n\r\nLine 3')).toBe('Line 1 Line 2');
    
    // Determinism
    const input = 'Deterministic test.';
    expect(condenseFinalMessage(input)).toBe(condenseFinalMessage(input));
    
    // Never throws
    expect(() => condenseFinalMessage(null)).not.toThrow();
    expect(() => condenseFinalMessage('')).not.toThrow();
    expect(() => condenseFinalMessage('a'.repeat(10000))).not.toThrow();
  });
});
