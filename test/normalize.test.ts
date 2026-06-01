import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalize.js';
import type { NormalizedEvent, EventKind } from '../src/normalize.js';
import type { RawHookEvent } from '../src/daemon.js';

describe('normalize()', () => {
  // Helper to create a base RawHookEvent
  const baseRaw = (overrides: Partial<RawHookEvent> = {}): RawHookEvent => ({
    v: 1,
    hook: 'Stop',
    sessionId: 'test-session',
    ts: '2026-06-01T12:00:00.000Z',
    payload: {},
    ...overrides
  });

  describe('Mapping & Fallback (Criteria 1, 2)', () => {
    const table: Array<[string, EventKind]> = [
      ['SessionStart', 'session-start'],
      ['Stop', 'run-finished'],
      ['SubagentStop', 'subagent-finished'],
      ['Notification', 'notification'],
      ['SessionEnd', 'session-end'],
      ['PreToolUse', 'unknown'],
      ['Unknown', 'unknown'],
      ['', 'unknown'],
      ['RandomHook', 'unknown'],
    ];

    it.each(table)('maps hook "%s" to kind "%s"', (hook, expectedKind) => {
      const raw = baseRaw({ hook });
      const result = normalize(raw);
      expect(result.kind).toBe(expectedKind);
    });
  });

  describe('Common Fields & Losslessness (Criteria 3, 4, 11)', () => {
    it('carries common fields verbatim and sets v=1', () => {
      const raw = baseRaw({
        hook: 'Stop',
        sessionId: 'specific-session',
        ts: '2026-06-01T12:34:56Z'
      });
      const result = normalize(raw);

      expect(result.v).toBe(1);
      expect(result.hook).toBe(raw.hook);
      expect(result.sessionId).toBe(raw.sessionId);
      expect(result.ts).toBe(raw.ts);
    });

    it('preserves the original raw event losslessly', () => {
      const raw = baseRaw({
        hook: 'Notification',
        payload: { message: 'hello', extra: 123 }
      });
      const result = normalize(raw);
      expect(result.raw).toStrictEqual(raw);
    });

    it('handles daemon-style empty payload {}', () => {
      const raw: RawHookEvent = {
        v: 1,
        hook: 'Notification',
        sessionId: 's1',
        ts: 'ts1',
        payload: {} // As delivered by daemon sink when wire line omitted it
      };
      const result = normalize(raw);
      expect(result.kind).toBe('notification');
      if (result.kind === 'notification') {
        expect(result.message).toBe('');
      }
    });
  });

  describe('Field Lifting (Criteria 5, 6, 7)', () => {
    describe('Notification -> message', () => {
      it('lifts string message', () => {
        const raw = baseRaw({ hook: 'Notification', payload: { message: 'system ready' } });
        const result = normalize(raw);
        expect(result.kind).toBe('notification');
        if (result.kind === 'notification') {
          expect(result.message).toBe('system ready');
        }
      });

      it.each([
        [undefined],
        [null],
        [123],
        [['array']],
        [{ obj: 1 }],
      ])('defaults message to empty string for non-string type: %s', (val) => {
        const raw = baseRaw({ hook: 'Notification', payload: { message: val } });
        const result = normalize(raw) as any;
        expect(result.message).toBe('');
      });
    });

    describe('SessionStart -> source', () => {
      it('lifts string source', () => {
        const raw = baseRaw({ hook: 'SessionStart', payload: { source: 'startup' } });
        const result = normalize(raw);
        expect(result.kind).toBe('session-start');
        if (result.kind === 'session-start') {
          expect(result.source).toBe('startup');
        }
      });

      it('defaults source to empty string when absent', () => {
        const raw = baseRaw({ hook: 'SessionStart', payload: {} });
        const result = normalize(raw) as any;
        expect(result.source).toBe('');
      });
    });

    describe('SessionEnd -> reason', () => {
      it('lifts string reason', () => {
        const raw = baseRaw({ hook: 'SessionEnd', payload: { reason: 'logout' } });
        const result = normalize(raw);
        expect(result.kind).toBe('session-end');
        if (result.kind === 'session-end') {
          expect(result.reason).toBe('logout');
        }
      });

      it('defaults reason to empty string for non-string type', () => {
        const raw = baseRaw({ hook: 'SessionEnd', payload: { reason: null } });
        const result = normalize(raw) as any;
        expect(result.reason).toBe('');
      });
    });
  });

  describe('Totality & Adversarial Inputs (Criterion 8)', () => {
    it('never throws regardless of payload content', () => {
      const adversarial = [
        baseRaw({ payload: null as any }),
        baseRaw({ payload: undefined as any }),
        baseRaw({ payload: { message: { nested: true } } as any }),
        baseRaw({ payload: { source: ['array'] } as any }),
        baseRaw({ payload: new Array(1000).fill('big').reduce((a, v, i) => ({ ...a, [i]: v }), {}) }),
        { ...baseRaw(), v: 'wrong' as any, sessionId: null as any } as any,
      ];

      for (const input of adversarial) {
        expect(() => normalize(input)).not.toThrow();
        const result = normalize(input);
        expect(result).toBeDefined();
        expect(typeof result.kind).toBe('string');
      }
    });

    it('handles hook names that collide with Object.prototype keys', () => {
      const collisions = [
        'toString',
        'constructor',
        'hasOwnProperty',
        '__proto__',
        'valueOf',
        'isPrototypeOf'
      ];

      for (const hook of collisions) {
        const raw = baseRaw({ hook });
        expect(() => normalize(raw)).not.toThrow();
        const result = normalize(raw);
        expect(result.kind).toBe('unknown');
      }
    });

    it('ignores fields named message/source/reason on the wrong kind', () => {
      // Stop event with fields from other kinds
      const raw = baseRaw({
        hook: 'Stop',
        payload: { message: 'oops', source: 'oops', reason: 'oops' }
      });
      const result = normalize(raw) as any;
      expect(result.kind).toBe('run-finished');
      expect(result.message).toBeUndefined();
      expect(result.source).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });
  });

  describe('Determinism & Immutability (Criteria 9, 10)', () => {
    it('is deterministic (same input yields deep-equal output)', () => {
      const raw = baseRaw({ hook: 'Notification', payload: { message: 'hello' } });
      const first = normalize(raw);
      const second = normalize(raw);
      expect(first).toStrictEqual(second);
      // Ensure it's not the same reference if implementation returns new objects
      expect(first).not.toBe(raw); 
    });

    it('does not mutate the input raw event', () => {
      const raw = baseRaw({ hook: 'SessionStart', payload: { source: 'resume' } });
      const snapshot = structuredClone(raw);
      
      normalize(raw);
      
      expect(raw).toStrictEqual(snapshot);
    });
  });

  describe('Type-level narrowing (Compile-time check)', () => {
    it('narrowing kind exposes correct fields', () => {
      const event = {} as NormalizedEvent;

      if (event.kind === 'notification') {
        const m: string = event.message;
        expect(typeof m).toBe('string');
        // @ts-expect-error - source should not exist on notification
        event.source;
      }

      if (event.kind === 'session-start') {
        const s: string = event.source;
        expect(typeof s).toBe('string');
        // @ts-expect-error - message should not exist on session-start
        event.message;
      }

      if (event.kind === 'session-end') {
        const r: string = event.reason;
        expect(typeof r).toBe('string');
      }
      
      expect(true).toBe(true); // Runtime pass
    });
  });
});
