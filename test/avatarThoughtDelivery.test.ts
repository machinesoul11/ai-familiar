import { describe, it, expect } from 'vitest';
import { createAvatarThoughtRecapEmitter, createAvatarThoughtDecisionSink } from '../src/avatarThoughtDelivery.js';
import { recapThought, decisionThought } from '../src/avatarThought.js';
import type { DeliveryChannel, AvatarThoughtMessage, ChannelMessage } from '../src/channel.js';
import type { ArchSummary } from '../src/summary.js';
import type { RoutedEvent } from '../src/bus.js';
import type { NormalizedEvent } from '../src/normalize.js';

function createFakeChannel() {
  const recorded: ChannelMessage[] = [];
  return {
    channel: {
      kind: 'visual' as const,
      deliver: (m: ChannelMessage) => { recorded.push(m); }
    } as DeliveryChannel,
    recorded
  };
}

describe('createAvatarThoughtRecapEmitter', () => {
  it('15. Returns a function of arity 2', () => {
    const { channel } = createFakeChannel();
    const emitter = createAvatarThoughtRecapEmitter(channel);
    expect(typeof emitter).toBe('function');
    expect(emitter.length).toBe(2);
  });

  it('16. With the default map: calling it delivers exactly one message to the channel, deep-equal to recapThought(summary, finalMessage) and with kind === "avatar-thought"', () => {
    const { channel, recorded } = createFakeChannel();
    const emitter = createAvatarThoughtRecapEmitter(channel);
    
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    const finalMessage = null;
    
    emitter(summary, finalMessage);
    
    expect(recorded.length).toBe(1);
    const expectedThought = recapThought(summary, finalMessage);
    expect(recorded[0]).toEqual(expectedThought);
    expect(recorded[0].kind).toBe('avatar-thought');
  });

  it('17. With an injected map returning a fixed message: that exact message (reference-equal) is delivered once', () => {
    const { channel, recorded } = createFakeChannel();
    const fixedMessage: AvatarThoughtMessage = { kind: 'avatar-thought', text: 'Fixed message' };
    const map = () => fixedMessage;
    const emitter = createAvatarThoughtRecapEmitter(channel, map);
    
    const summary: ArchSummary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] };
    emitter(summary, null);
    
    expect(recorded.length).toBe(1);
    expect(recorded[0]).toBe(fixedMessage);
  });

  it('18. With an injected map returning null: channel.deliver is never called', () => {
    const { channel, recorded } = createFakeChannel();
    const map = () => null;
    const emitter = createAvatarThoughtRecapEmitter(channel, map);
    
    const summary: ArchSummary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] };
    emitter(summary, null);
    
    expect(recorded.length).toBe(0);
  });

  it('19. Returns undefined (void); at most one deliver per call', () => {
    const { channel, recorded } = createFakeChannel();
    const emitter = createAvatarThoughtRecapEmitter(channel);
    
    const summary: ArchSummary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] };
    const result = emitter(summary, null);
    
    expect(result).toBeUndefined();
    expect(recorded.length).toBeLessThanOrEqual(1);
  });
});

describe('createAvatarThoughtDecisionSink', () => {
  it('20. Returns a DecisionSink (a function of arity 1)', () => {
    const { channel } = createFakeChannel();
    const sink = createAvatarThoughtDecisionSink(channel);
    expect(typeof sink).toBe('function');
    expect(sink.length).toBe(1);
  });

  it('21. With the default map and a needs-you routed event: delivers exactly one message, deep-equal to decisionThought(routed), kind === "avatar-thought"', () => {
    const { channel, recorded } = createFakeChannel();
    const sink = createAvatarThoughtDecisionSink(channel);
    
    const routed: RoutedEvent = {
      event: { v: 1, kind: 'notification', hook: 'Notification', sessionId: 's', ts: 't', raw: {} as any, message: 'Test input needed' } as NormalizedEvent,
      decision: { channel: 'notification', reason: 'needs-input' }
    };
    
    sink(routed);
    
    expect(recorded.length).toBe(1);
    const expectedThought = decisionThought(routed);
    expect(recorded[0]).toEqual(expectedThought);
    expect(recorded[0].kind).toBe('avatar-thought');
  });

  it('22. With the default map and a non-needs-you routed event: channel.deliver is never called', () => {
    const { channel, recorded } = createFakeChannel();
    const sink = createAvatarThoughtDecisionSink(channel);
    
    const routed: RoutedEvent = {
      event: { v: 1, kind: 'run-finished', hook: 'RunFinished', sessionId: 's', ts: 't', raw: {} as any } as NormalizedEvent,
      decision: { channel: 'notification', reason: 'run-finished' }
    };
    
    sink(routed);
    
    expect(recorded.length).toBe(0);
  });

  it('23. Honors an injected map override (fixed message ⇒ that exact message delivered reference-equal; null ⇒ no delivery)', () => {
    const fixedMessage: AvatarThoughtMessage = { kind: 'avatar-thought', text: 'Fixed decision text' };
    const { channel: channel1, recorded: recorded1 } = createFakeChannel();
    const sink1 = createAvatarThoughtDecisionSink(channel1, () => fixedMessage);
    
    const routed: RoutedEvent = { event: {} as any, decision: { channel: 'none', reason: 'silent' } };
    sink1(routed);
    
    expect(recorded1.length).toBe(1);
    expect(recorded1[0]).toBe(fixedMessage);

    const { channel: channel2, recorded: recorded2 } = createFakeChannel();
    const sink2 = createAvatarThoughtDecisionSink(channel2, () => null);
    
    sink2(routed);
    
    expect(recorded2.length).toBe(0);
  });

  it('24. Returns undefined (void); at most one deliver per call', () => {
    const { channel, recorded } = createFakeChannel();
    const sink = createAvatarThoughtDecisionSink(channel);
    
    const routed: RoutedEvent = {
      event: { v: 1, kind: 'notification', hook: 'Notification', sessionId: 's', ts: 't', raw: {} as any, message: 'Need permission' } as NormalizedEvent,
      decision: { channel: 'notification', reason: 'needs-permission' }
    };
    
    const result = sink(routed);
    
    expect(result).toBeUndefined();
    expect(recorded.length).toBeLessThanOrEqual(1);
  });
});
