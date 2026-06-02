import { describe, it, expect } from 'vitest';
import { decisionMessage, NEEDS_PERMISSION_LINE, NEEDS_INPUT_LINE } from '../src/decisionMessage.js';
import type { RoutedEvent } from '../src/bus.js';
import type { NormalizedEvent, EventKind } from '../src/normalize.js';

// Helper to construct fixtures that match the shapes provided in the contract
function buildRouted(reason: string, eventKind: EventKind, eventOverrides: any = {}): RoutedEvent {
  const raw = { v: 1, hook: 'test', sessionId: 's', ts: 't', payload: {} } as any;
  const event = {
    v: 1 as const,
    kind: eventKind,
    hook: 'test',
    sessionId: 's',
    ts: 't',
    raw,
    ...eventOverrides
  } as NormalizedEvent;

  return {
    event,
    decision: { channel: 'notification', reason }
  };
}

describe('decisionMessage policy', () => {
  it('AC 1: needs-permission on a notification event with message -> that message', () => {
    const routed = buildRouted('needs-permission', 'notification', { message: 'Claude needs permission to use Bash' });
    expect(decisionMessage(routed)).toEqual({ kind: 'spoken', text: 'Claude needs permission to use Bash' });
  });

  it('AC 2: needs-input on a notification event with non-blank message -> flattened message', () => {
    const routed = buildRouted('needs-input', 'notification', { message: 'Hello world' });
    expect(decisionMessage(routed)).toEqual({ kind: 'spoken', text: 'Hello world' });
  });

  it('AC 3: needs-permission with empty message -> canned line', () => {
    const routed = buildRouted('needs-permission', 'notification', { message: '' });
    expect(decisionMessage(routed)).toEqual({ kind: 'spoken', text: NEEDS_PERMISSION_LINE });
  });

  it('AC 4: needs-input with whitespace-only message -> canned line', () => {
    const routed = buildRouted('needs-input', 'notification', { message: '   \n ' });
    expect(decisionMessage(routed)).toEqual({ kind: 'spoken', text: NEEDS_INPUT_LINE });
  });

  it('AC 5: notification message containing newlines and multiple spaces -> flattened and trimmed', () => {
    const routed = buildRouted('needs-input', 'notification', { message: ' \n  line one\n\n  line two \t ' });
    expect(decisionMessage(routed)).toEqual({ kind: 'spoken', text: 'line one line two' });
  });

  it('AC 6: run-finished -> null (no double-speak)', () => {
    const routed = buildRouted('run-finished', 'run-finished');
    expect(decisionMessage(routed)).toBeNull();
  });

  it('AC 7: subagent-progress -> null', () => {
    const routed = buildRouted('subagent-progress', 'subagent-finished');
    expect(decisionMessage(routed)).toBeNull();
  });

  it('AC 8: silent -> null', () => {
    const routed = buildRouted('silent', 'unknown');
    expect(decisionMessage(routed)).toBeNull();
  });

  it('AC 9: unrecognised reason -> null (default-deny)', () => {
    const routed = buildRouted('some-future-reason', 'notification', { message: 'stuff' });
    expect(decisionMessage(routed)).toBeNull();
  });

  it('AC 10: needs-permission/needs-input on non-notification event -> canned line', () => {
    const routedPerm = buildRouted('needs-permission', 'unknown');
    expect(decisionMessage(routedPerm)).toEqual({ kind: 'spoken', text: NEEDS_PERMISSION_LINE });

    const routedInput = buildRouted('needs-input', 'run-finished');
    expect(decisionMessage(routedInput)).toEqual({ kind: 'spoken', text: NEEDS_INPUT_LINE });
  });

  it('AC 11: Pure/total/deterministic, never throws, does not mutate', () => {
    const routed = buildRouted('needs-input', 'notification', { message: 'pure  test' });
    
    // Deep freeze input to guarantee no mutation occurs
    Object.freeze(routed.event.raw);
    Object.freeze(routed.event);
    Object.freeze(routed.decision);
    Object.freeze(routed);

    expect(() => decisionMessage(routed)).not.toThrow();
    
    const res1 = decisionMessage(routed);
    const res2 = decisionMessage(routed);

    expect(res1).toEqual({ kind: 'spoken', text: 'pure test' });
    expect(res1).toEqual(res2); // Deterministic guarantee
  });
});
