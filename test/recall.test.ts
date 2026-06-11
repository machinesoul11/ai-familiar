import { describe, it, expect, vi } from 'vitest';
import { buildAwayRollup, shapeAwayRollup, createRecall } from '../src/recall.js';
import type { LedgerRow } from '../src/ledger.js';

describe('recall', () => {
  describe('buildAwayRollup', () => {
    it('returns default for empty input (AC 1)', () => {
      const result = buildAwayRollup([]);
      expect(result).toEqual({
        kind: 'away-rollup',
        sessionCount: 0,
        runsLanded: 0,
        subagentsFinished: 0,
        needsYou: 0
      });
    });

    it('counts runsLanded as rows with kind === "run-finished" only (AC 2)', () => {
      const rows: Partial<LedgerRow>[] = [
        { kind: 'run-finished', sessionId: 's1' },
        { kind: 'run-finished', sessionId: 's1' },
        { kind: 'session-start', sessionId: 's1' },
      ];
      const result = buildAwayRollup(rows as LedgerRow[]);
      expect(result.runsLanded).toBe(2);
    });

    it('counts subagentsFinished as rows with kind === "subagent-finished" only (AC 3)', () => {
      const rows: Partial<LedgerRow>[] = [
        { kind: 'subagent-finished', sessionId: 's1' },
        { kind: 'subagent-finished', sessionId: 's1' },
        { kind: 'subagent-finished', sessionId: 's1' },
      ];
      const result = buildAwayRollup(rows as LedgerRow[]);
      expect(result.subagentsFinished).toBe(3);
    });

    it('counts needsYou for reason === "needs-permission" OR "needs-input" (AC 4)', () => {
      const rows: Partial<LedgerRow>[] = [
        { reason: 'needs-permission', sessionId: 's1' },
        { reason: 'needs-input', sessionId: 's1' },
        { reason: 'other', sessionId: 's1' },
      ];
      const result = buildAwayRollup(rows as LedgerRow[]);
      expect(result.needsYou).toBe(2);
    });

    it('counts distinct sessionIds across the rows (AC 5)', () => {
      const rows: Partial<LedgerRow>[] = [
        { sessionId: 's1' },
        { sessionId: 's2' },
        { sessionId: 's1' },
        { sessionId: '' },
      ];
      const result = buildAwayRollup(rows as LedgerRow[]);
      expect(result.sessionCount).toBe(3);
    });

    it('increments sessionCount for unmatched rows but no count bucket (AC 6)', () => {
      const rows: Partial<LedgerRow>[] = [
        { kind: 'unknown', reason: 'unknown', sessionId: 's1' },
      ];
      const result = buildAwayRollup(rows as LedgerRow[]);
      expect(result.sessionCount).toBe(1);
      expect(result.runsLanded).toBe(0);
      expect(result.subagentsFinished).toBe(0);
      expect(result.needsYou).toBe(0);
    });

    it('is order-independent and does not mutate the input array (AC 7)', () => {
      const row1: LedgerRow = { id: 1, ts: '2026-06-01T10:00:00Z', hook: 'H1', sessionId: 's1', kind: 'run-finished', channel: 'notification', reason: 'run-finished' };
      const row2: LedgerRow = { id: 2, ts: '2026-06-01T10:00:01Z', hook: 'H2', sessionId: 's2', kind: 'subagent-finished', channel: 'audio', reason: 'subagent-progress' };
      const rows = [row1, row2];
      const rowsCopy = [...rows];
      
      const res1 = buildAwayRollup(rows);
      const res2 = buildAwayRollup([row2, row1]);
      
      expect(res1).toEqual(res2);
      expect(rows).toEqual(rowsCopy);
    });
  });

  describe('shapeAwayRollup', () => {
    it('returns a SpokenMessage (kind: "spoken") (AC 8)', () => {
      const result = shapeAwayRollup({ kind: 'away-rollup', sessionCount: 1, runsLanded: 1, subagentsFinished: 1, needsYou: 1 });
      expect(result.kind).toBe('spoken');
    });

    it('returns exact string for empty/all-zero rollup (AC 9)', () => {
      const result = shapeAwayRollup({ kind: 'away-rollup', sessionCount: 0, runsLanded: 0, subagentsFinished: 0, needsYou: 0 });
      expect(result.text).toBe('While you were away: nothing to report.');
    });

    it('produces exact strings for §2.2 worked examples (AC 10)', () => {
      // Ex 1: 1 session (omitted), 2 needs-you, 1 run, 12 subagents
      expect(shapeAwayRollup({kind: 'away-rollup', sessionCount: 1, runsLanded: 1, subagentsFinished: 12, needsYou: 2}).text)
        .toBe('While you were away: 2 needs-you moments, 1 run landed, 12 subagents finished.');
      
      // Ex 2: 1 session, 0 runs, 1 subagent, 0 needs-you
      expect(shapeAwayRollup({kind: 'away-rollup', sessionCount: 1, runsLanded: 0, subagentsFinished: 1, needsYou: 0}).text)
        .toBe('While you were away: 1 subagent finished.');
      
      // Ex 3: 3 sessions, 0 everything else
      expect(shapeAwayRollup({kind: 'away-rollup', sessionCount: 3, runsLanded: 0, subagentsFinished: 0, needsYou: 0}).text)
        .toBe('While you were away: 3 sessions.');
      
      // Ex 4: 0 everything
      expect(shapeAwayRollup({kind: 'away-rollup', sessionCount: 0, runsLanded: 0, subagentsFinished: 0, needsYou: 0}).text)
        .toBe('While you were away: nothing to report.');
      
      // Ex 5: 1 session, 0 runs, 0 subagents, 1 needs-you
      expect(shapeAwayRollup({kind: 'away-rollup', sessionCount: 1, runsLanded: 0, subagentsFinished: 0, needsYou: 1}).text)
        .toBe('While you were away: 1 needs-you moment.');
    });
  });

  describe('createRecall', () => {
    it('calls loadRows once, then dispatch exactly once with target "audio" and SpokenMessage (AC 11, 13)', () => {
      const rows: LedgerRow[] = [{ id: 1, ts: '...', hook: '...', sessionId: 's1', kind: 'run-finished', channel: 'notification', reason: 'run-finished' }];
      const loadRows = vi.fn(() => rows);
      const dispatch = vi.fn();
      
      const recall = createRecall({ loadRows, dispatch });
      recall();
      
      expect(loadRows).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('audio', expect.objectContaining({ 
        kind: 'spoken',
        text: expect.stringContaining('While you were away:')
      }));
    });

    it('calls onSpoken once with the SAME message object and emit once with text (AC 12)', () => {
      const rows: LedgerRow[] = [];
      const loadRows = () => rows;
      const dispatch = vi.fn();
      const onSpoken = vi.fn();
      const emit = vi.fn();
      
      const recall = createRecall({ loadRows, dispatch, onSpoken, emit });
      recall();
      
      // AC 12: onSpoken called with SAME message object dispatched
      const message = dispatch.mock.calls[0][1];
      expect(onSpoken).toHaveBeenCalledWith(message);
      
      // AC 12: emit called with message text
      expect(emit).toHaveBeenCalledWith(message.text);
    });

    it('tolerates both onSpoken and emit being omitted (AC 12)', () => {
      const loadRows = () => [];
      const dispatch = vi.fn();
      const recall = createRecall({ loadRows, dispatch });
      expect(() => recall()).not.toThrow();
    });

    it('uses "audio" target even for empty "nothing to report" case (AC 13)', () => {
      const loadRows = () => [];
      const dispatch = vi.fn();
      const recall = createRecall({ loadRows, dispatch });
      recall();
      expect(dispatch).toHaveBeenCalledWith('audio', expect.objectContaining({
        text: 'While you were away: nothing to report.'
      }));
    });
  });
});
