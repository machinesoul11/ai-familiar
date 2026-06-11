import { describe, it, expect } from 'vitest';
import { classifyUtterance } from '../src/utterance.js';

describe('classifyUtterance', () => {
  // AC 9: Each of the 6 RECALL_PHRASES (exact string) → 'recall'.
  it('9. classifies each RECALL_PHRASE as recall', () => {
    const phrases = [
      'while i was away',
      'while i was gone',
      'what did i miss',
      'what i missed',
      'catch me up',
      'recall'
    ];
    for (const p of phrases) {
      expect(classifyUtterance(p)).toBe('recall');
    }
  });

  // AC 10: Each of the 6 RECAP_PHRASES (exact string) → 'pull-recap'.
  it('10. classifies each RECAP_PHRASE as pull-recap', () => {
    const phrases = [
      'recap',
      'status',
      'what happened',
      'where are we',
      'summary',
      'summarize'
    ];
    for (const p of phrases) {
      expect(classifyUtterance(p)).toBe('pull-recap');
    }
  });

  // AC 11: Case-insensitive: 'RECAP' → 'pull-recap'; 'Recap' → 'pull-recap'; 'WHAT DID I MISS' → 'recall'.
  it('11. is case-insensitive', () => {
    expect(classifyUtterance('RECAP')).toBe('pull-recap');
    expect(classifyUtterance('Recap')).toBe('pull-recap');
    expect(classifyUtterance('WHAT DID I MISS')).toBe('recall');
  });

  // AC 12: Leading/trailing whitespace tolerated: '  recap  ' → 'pull-recap'.
  it('12. tolerates leading/trailing whitespace', () => {
    expect(classifyUtterance('  recap  ')).toBe('pull-recap');
    expect(classifyUtterance('\twhile i was away\n')).toBe('recall');
  });

  // AC 13: Phrase embedded in a sentence: 'hey haru give me a recap please' → 'pull-recap'; 'so what did i miss while gone' → 'recall'.
  it('13. handles phrases embedded in a sentence', () => {
    expect(classifyUtterance('hey haru give me a recap please')).toBe('pull-recap');
    expect(classifyUtterance('so what did i miss while gone')).toBe('recall');
    expect(classifyUtterance('I want to summarize the progress')).toBe('pull-recap');
  });

  // AC 14: Precedence: a string containing BOTH (e.g. 'recap but really what did i miss') → 'recall'.
  it('14. recall takes precedence over recap if both are present', () => {
    expect(classifyUtterance('recap but really what did i miss')).toBe('recall');
    expect(classifyUtterance('summarize while i was away')).toBe('recall');
  });

  // AC 15: '' → null; whitespace-only '   ' → null.
  it('15. returns null for empty or whitespace-only strings', () => {
    expect(classifyUtterance('')).toBeNull();
    expect(classifyUtterance('   ')).toBeNull();
    expect(classifyUtterance('\n\r\t')).toBeNull();
  });

  // AC 16: Unrelated text → null: 'what time is it' → null; 'open the pod bay doors' → null.
  it('16. returns null for unrelated text', () => {
    expect(classifyUtterance('what time is it')).toBeNull();
    expect(classifyUtterance('open the pod bay doors')).toBeNull();
    expect(classifyUtterance('hello world')).toBeNull();
  });
});
