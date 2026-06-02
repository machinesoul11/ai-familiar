import { describe, it, expect, beforeEach } from 'vitest';
import { createDecisionDelivery } from '../src/decisionDelivery.js';
import { NEEDS_INPUT_LINE } from '../src/decisionMessage.js';
import type { ChannelMessage } from '../src/channel.js';
import type { Channel } from '../src/router.js';
import type { RoutedEvent } from '../src/bus.js';
import type { Dispatcher } from '../src/dispatch.js';

// Helper to construct fixtures matching structural types from the contract
function buildRouted(channel: Channel, reason: string, eventOverrides: any = {}): RoutedEvent {
  return {
    event: {
      v: 1 as const,
      kind: eventOverrides.kind || 'unknown',
      hook: 'test',
      sessionId: 's',
      ts: 't',
      raw: { v: 1, hook: 'test', sessionId: 's', ts: 't', payload: {} } as any,
      ...eventOverrides
    },
    decision: { channel, reason }
  } as RoutedEvent;
}

describe('createDecisionDelivery', () => {
  let dispatches: Array<[Channel, ChannelMessage]> = [];
  
  const fakeDispatch: Dispatcher = (target, message) => {
    dispatches.push([target, message]);
  };

  beforeEach(() => {
    dispatches = [];
  });

  it('AC 12: mapMessage returns a message -> dispatch called exactly once with (channel, message)', () => {
    const mapMessage = () => ({ kind: 'spoken', text: 'mapped' } as const);
    const sink = createDecisionDelivery(fakeDispatch, mapMessage);
    const routed = buildRouted('audio', 'test-reason');

    sink(routed);

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toEqual(['audio', { kind: 'spoken', text: 'mapped' }]);
  });

  it('AC 13: mapMessage returns null -> dispatch not called', () => {
    const mapMessage = () => null;
    const sink = createDecisionDelivery(fakeDispatch, mapMessage);
    const routed = buildRouted('notification', 'test-reason');

    sink(routed);

    expect(dispatches).toHaveLength(0);
  });

  it('AC 14: dispatch target is routed.decision.channel verbatim', () => {
    const mapMessage = () => ({ kind: 'spoken', text: 'msg' } as const);
    const sink = createDecisionDelivery(fakeDispatch, mapMessage);

    const routed1 = buildRouted('audio', 'r1');
    sink(routed1);
    expect(dispatches[0][0]).toBe('audio');

    const routed2 = buildRouted('notification', 'r2');
    sink(routed2);
    expect(dispatches[1][0]).toBe('notification');

    expect(dispatches).toHaveLength(2);
  });

  it('AC 15: Default policy wired (no mapMessage provided)', () => {
    const sink = createDecisionDelivery(fakeDispatch);

    // needs-input notification event -> dispatches spoken message
    const routedInput = buildRouted('notification', 'needs-input', { kind: 'notification', message: 'Hello' });
    sink(routedInput);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toEqual(['notification', { kind: 'spoken', text: 'Hello' }]);

    // run-finished event -> dispatches nothing
    const routedDone = buildRouted('none', 'run-finished', { kind: 'run-finished' });
    sink(routedDone);
    expect(dispatches).toHaveLength(1); // No new dispatch occurred
  });

  it('AC 16: Construction calls dispatch zero times, returns a function', () => {
    const sink = createDecisionDelivery(fakeDispatch);
    
    expect(typeof sink).toBe('function');
    expect(dispatches).toHaveLength(0);
  });

  it('AC 17: Per routed event, sink calls dispatch at most once', () => {
    const sink = createDecisionDelivery(fakeDispatch);

    // Event that triggers default policy
    const routedInput = buildRouted('notification', 'needs-input', { kind: 'notification', message: 'Hi' });
    sink(routedInput);
    expect(dispatches).toHaveLength(1); // Called once

    // Event that triggers null (silent)
    const routedSilent = buildRouted('audio', 'silent');
    sink(routedSilent);
    expect(dispatches).toHaveLength(1); // Still 1

    // Event that triggers default policy again
    sink(routedInput);
    expect(dispatches).toHaveLength(2); // Exactly +1 call
  });
});
