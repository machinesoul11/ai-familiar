import { describe, it, expect } from 'vitest';
import { shapePullRecap, createPullRecap, NO_RECAP_LINE } from '../src/pullRecap.js';
import { formatArchRecap } from '../src/recap.js';
import type { ArchSummary } from '../src/summary.js';
import type { Dispatcher } from '../src/dispatch.js';
import type { RecapSnapshot } from '../src/recapSnapshot.js';

describe('pullRecap.ts', () => {
  const emptySummary: ArchSummary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] };
  
  const fullSummary: ArchSummary = {
    kind: 'arch-summary',
    modules: [
      { module: 'm1', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 },
      { module: 'm2', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 },
      { module: 'm3', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 },
      { module: 'm4', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 },
    ],
    protectedHits: [
      { path: 'p1', status: 'modified', pattern: '.*' },
      { path: 'p2', status: 'modified', pattern: '.*' },
    ],
    violations: [
      { fromModule: 'a', toModule: 'b', fromFile: 'a.ts', specifier: 'b', rule: { from: 'a', to: 'b' } }
    ],
    newCouplings: [
      { fromModule: 'c', toModule: 'd', fromFile: 'c.ts', specifier: 'd' }
    ]
  };

  describe('shapePullRecap', () => {
    it('AC 13: narration present + all moat empty', () => {
      const res = shapePullRecap({ summary: emptySummary, finalMessage: 'Added features.' });
      expect(res).toEqual({
        kind: 'spoken',
        text: 'Added features. Familiar flagged no architectural concerns.'
      });
    });

    it('AC 14: narration present + v=1, p=2, m=4, c=1', () => {
      const res = shapePullRecap({ summary: fullSummary, finalMessage: 'Added backlinks and tag parsing' });
      expect(res).toEqual({
        kind: 'spoken',
        text: 'Added backlinks and tag parsing Familiar flagged 1 boundary violation, 2 protected zones touched, 4 modules changed, 1 new cross-module coupling.'
      });
      // Explicit assertion that the modules changed clause is present
      expect(res.text).toContain('4 modules changed');
    });

    it('AC 15: finalMessage:null + v=1, p=2, m=4, c=1', () => {
      const res = shapePullRecap({ summary: fullSummary, finalMessage: null });
      expect(res).toEqual({
        kind: 'spoken',
        text: 'Run landed: 1 boundary violation, 2 protected zones touched, 4 modules changed, 1 new cross-module coupling.'
      });
    });

    it('AC 16: finalMessage:null + all empty', () => {
      const res = shapePullRecap({ summary: emptySummary, finalMessage: null });
      expect(res).toEqual({
        kind: 'spoken',
        text: 'Run landed. No architectural changes.'
      });
    });

    it('AC 17: Uncapped narration', () => {
      const longMsg = 'A'.repeat(800);
      const res = shapePullRecap({ summary: emptySummary, finalMessage: longMsg });
      expect(res.text.startsWith(longMsg)).toBe(true);
      expect(res.text.length).toBeGreaterThan(800);
    });

    it('AC 18: Whole-message (not lead-block) flattened', () => {
      const res = shapePullRecap({ summary: emptySummary, finalMessage: 'First para.\n\nSecond para.' });
      expect(res.text).toBe('First para. Second para. Familiar flagged no architectural concerns.');
    });

    it('AC 19: Flatten rules', () => {
      const res1 = shapePullRecap({ summary: emptySummary, finalMessage: '##   Title \r\n  Body   text.' });
      expect(res1.text).toBe('Title Body text. Familiar flagged no architectural concerns.');

      const res2 = shapePullRecap({ summary: emptySummary, finalMessage: '- Item 1\n- Item 2' });
      expect(res2.text).toBe('Item 1 - Item 2 Familiar flagged no architectural concerns.');

      const res3 = shapePullRecap({ summary: emptySummary, finalMessage: '1. First\n2. Second' });
      expect(res3.text).toBe('First 2. Second Familiar flagged no architectural concerns.');
    });

    it('AC 20: whitespace-only or marker-only narration treated as null', () => {
      const ws = shapePullRecap({ summary: emptySummary, finalMessage: '   \n  ' });
      expect(ws.text).toBe('Run landed. No architectural changes.');

      const marker = shapePullRecap({ summary: emptySummary, finalMessage: '### ' });
      expect(marker.text).toBe('Run landed. No architectural changes.');
    });

    it('AC 21: Singular/plural pinned', () => {
      const mix1: ArchSummary = { ...emptySummary, violations: [{ fromModule: 'a', toModule: 'b', fromFile: 'a.ts', specifier: 'b', rule: { from: 'a', to: 'b' } }] };
      const mix2: ArchSummary = {
        ...emptySummary,
        violations: [
          { fromModule: 'a', toModule: 'b', fromFile: 'a.ts', specifier: 'b', rule: { from: 'a', to: 'b' } },
          { fromModule: 'a', toModule: 'b', fromFile: 'a.ts', specifier: 'b', rule: { from: 'a', to: 'b' } }
        ],
        modules: [{ module: 'm1', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 }]
      };

      const res1 = shapePullRecap({ summary: mix1, finalMessage: null });
      expect(res1.text).toContain('1 boundary violation');
      expect(res1.text).not.toContain('violations');
      
      const res2 = shapePullRecap({ summary: mix2, finalMessage: null });
      expect(res2.text).toContain('2 boundary violations');
      expect(res2.text).toContain('1 module changed');
      expect(res2.text).not.toContain('modules changed');
    });

    it('AC 22: Returns kind:spoken and never throws', () => {
      expect(() => shapePullRecap({ summary: emptySummary, finalMessage: null })).not.toThrow();
      const res = shapePullRecap({ summary: emptySummary, finalMessage: null });
      expect(res.kind).toBe('spoken');
    });
  });

  describe('createPullRecap', () => {
    const dummySummary: ArchSummary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] };
    const dummySnapshot: RecapSnapshot = { v: 1, summary: dummySummary, finalMessage: 'Hello' };

    it('AC 23: snapshot present -> dispatch audio & emit structured recap', () => {
      const calls: Array<{target: any; message: any}> = [];
      const dispatch: Dispatcher = (target, message) => { calls.push({ target, message }); };
      const loadSnapshot = () => dummySnapshot;
      const emitted: string[] = [];
      const emit = (t: string) => { emitted.push(t); };

      const pull = createPullRecap({ loadSnapshot, dispatch, emit });
      pull();

      expect(calls.length).toBe(1);
      expect(calls[0].target).toBe('audio'); // AC 25 checked here
      expect(calls[0].message).toEqual(shapePullRecap({ summary: dummySummary, finalMessage: 'Hello' }));
      
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe(formatArchRecap(dummySummary));
    });

    it('AC 24: snapshot null -> dispatch NO_RECAP_LINE & emit NO_RECAP_LINE', () => {
      const calls: Array<{target: any; message: any}> = [];
      const dispatch: Dispatcher = (target, message) => { calls.push({ target, message }); };
      const loadSnapshot = () => null;
      const emitted: string[] = [];
      const emit = (t: string) => { emitted.push(t); };

      const pull = createPullRecap({ loadSnapshot, dispatch, emit });
      pull();

      expect(calls.length).toBe(1);
      expect(calls[0].target).toBe('audio'); // AC 25 checked here
      expect(calls[0].message).toEqual({ kind: 'spoken', text: NO_RECAP_LINE });
      
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe(NO_RECAP_LINE);
    });

    it('AC 26: emit optional, still dispatches, no throw', () => {
      const calls: Array<{target: any; message: any}> = [];
      const dispatch: Dispatcher = (target, message) => { calls.push({ target, message }); };
      const loadSnapshot = () => dummySnapshot;

      const pull = createPullRecap({ loadSnapshot, dispatch });
      expect(() => pull()).not.toThrow();
      expect(calls.length).toBe(1);
    });

    it('AC 27 & 28: Construction calls neither, pull() returns undefined and never throws', () => {
      let loadCalls = 0;
      let dispatchCalls = 0;
      const loadSnapshot = () => { loadCalls++; return dummySnapshot; };
      const dispatch: Dispatcher = () => { dispatchCalls++; };

      const pull = createPullRecap({ loadSnapshot, dispatch });
      expect(loadCalls).toBe(0);
      expect(dispatchCalls).toBe(0);

      const res = pull();
      expect(res).toBeUndefined();
      expect(loadCalls).toBe(1);
      expect(dispatchCalls).toBe(1);
    });

    it('AC 29: loadSnapshot re-read per call', () => {
      let loadCalls = 0;
      let currentSnap: RecapSnapshot | null = null;
      const loadSnapshot = () => { loadCalls++; return currentSnap; };
      const dispatch: Dispatcher = () => {};

      const pull = createPullRecap({ loadSnapshot, dispatch });
      pull();
      expect(loadCalls).toBe(1);

      currentSnap = dummySnapshot;
      pull();
      expect(loadCalls).toBe(2);
    });
  });
});
