import { describe, it, expect } from 'vitest';
import { avatarMessage } from '../src/avatarMessage.js';
import type { EventKind, NormalizedEvent } from '../src/normalize.js';

function evt(kind: EventKind, extra: Record<string, unknown> = {}): NormalizedEvent {
  return {
    v: 1, kind, hook: 'h', sessionId: 's', ts: 't',
    raw: { v: 1, hook: 'h', sessionId: 's', ts: 't', payload: {} },
    ...extra
  } as NormalizedEvent;
}

describe('avatarMessage', () => {
  it('AC 1: session-start -> working/false', () => {
    const e = evt('session-start', { source: 'user' });
    expect(avatarMessage(e)).toEqual({ kind: 'avatar-state', phase: 'working', ready: false });
  });

  it('AC 2: subagent-finished -> working/false', () => {
    const e = evt('subagent-finished');
    expect(avatarMessage(e)).toEqual({ kind: 'avatar-state', phase: 'working', ready: false });
  });

  it('AC 3: notification -> blocked/false, independent of message', () => {
    const e1 = evt('notification', { message: 'permission needed' });
    const e2 = evt('notification', { message: 'input needed' });
    const e3 = evt('notification', { message: '' });
    const expected = { kind: 'avatar-state', phase: 'blocked', ready: false };
    expect(avatarMessage(e1)).toEqual(expected);
    expect(avatarMessage(e2)).toEqual(expected);
    expect(avatarMessage(e3)).toEqual(expected);
  });

  it('AC 4: run-finished -> done/true', () => {
    const e = evt('run-finished');
    expect(avatarMessage(e)).toEqual({ kind: 'avatar-state', phase: 'done', ready: true });
  });

  it('AC 5: session-end -> idle/false', () => {
    const e = evt('session-end', { reason: 'exit' });
    expect(avatarMessage(e)).toEqual({ kind: 'avatar-state', phase: 'idle', ready: false });
  });

  it('AC 6: unknown -> null', () => {
    const e = evt('unknown');
    expect(avatarMessage(e)).toBeNull();
  });

  it('AC 7: Totality', () => {
    const allKinds: EventKind[] = [
      'session-start', 'run-finished', 'subagent-finished',
      'notification', 'session-end', 'unknown'
    ];
    for (const kind of allKinds) {
      expect(() => {
        const e = evt(kind);
        const result = avatarMessage(e);
        if (result !== null) {
          expect(result.kind).toBe('avatar-state');
          expect(['idle', 'working', 'blocked', 'done']).toContain(result.phase);
          expect(typeof result.ready).toBe('boolean');
        }
      }).not.toThrow();
    }
  });

  it('AC 8: Returns fresh object', () => {
    const e1 = evt('run-finished');
    const e2 = evt('run-finished');
    const res1 = avatarMessage(e1);
    const res2 = avatarMessage(e2);
    
    expect(res1).toEqual(res2);
    expect(res1).not.toBe(res2);
  });

  it('AC 9: Does not mutate input', () => {
    const e = evt('session-start', { source: 'test' });
    const clone = JSON.parse(JSON.stringify(e));
    avatarMessage(e);
    expect(e).toEqual(clone);
  });
});
