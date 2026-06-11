import { describe, it, expect } from 'vitest';
import { createAvatarSubscriber } from '../src/avatarSubscriber.js';
import type { DeliveryChannel, ChannelMessage } from '../src/channel.js';
import type { EventKind, NormalizedEvent } from '../src/normalize.js';

function evt(kind: EventKind, extra: Record<string, unknown> = {}): NormalizedEvent {
  return {
    v: 1, kind, hook: 'h', sessionId: 's', ts: 't',
    raw: { v: 1, hook: 'h', sessionId: 's', ts: 't', payload: {} },
    ...extra
  } as NormalizedEvent;
}

describe('createAvatarSubscriber', () => {
  it('AC 10: Returns a function of arity 1', () => {
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: () => {} };
    const sub = createAvatarSubscriber(fakeChannel);
    expect(typeof sub).toBe('function');
    expect(sub.length).toBe(1);
  });

  it('AC 11: Maps to message -> delivers exactly once with reference-equal object', () => {
    const calls: ChannelMessage[] = [];
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: (m) => calls.push(m) };
    const msg = { kind: 'avatar-state' as const, phase: 'working' as const, ready: false };
    const sub = createAvatarSubscriber(fakeChannel, () => msg);
    
    sub(evt('session-start'));
    
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(msg);
  });

  it('AC 12: Maps to null -> never calls deliver', () => {
    const calls: ChannelMessage[] = [];
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: (m) => calls.push(m) };
    const sub = createAvatarSubscriber(fakeChannel, () => null);
    
    sub(evt('session-start'));
    
    expect(calls.length).toBe(0);
  });

  it('AC 13: Uses default map -> run-finished delivers done/true', () => {
    const calls: ChannelMessage[] = [];
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: (m) => calls.push(m) };
    const sub = createAvatarSubscriber(fakeChannel);
    
    sub(evt('run-finished'));
    
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ kind: 'avatar-state', phase: 'done', ready: true });
  });

  it('AC 14: Honors injected map override (returns fixed message or null)', () => {
    const calls: ChannelMessage[] = [];
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: (m) => calls.push(m) };
    const customMsg = { kind: 'avatar-state' as const, phase: 'idle' as const, ready: true };
    const map = (e: NormalizedEvent) => e.kind === 'unknown' ? customMsg : null;
    const sub = createAvatarSubscriber(fakeChannel, map);
    
    sub(evt('session-start'));
    expect(calls.length).toBe(0);
    
    sub(evt('unknown'));
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(customMsg);
  });

  it('AC 15: One event -> at most one deliver call', () => {
    const calls: ChannelMessage[] = [];
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: (m) => calls.push(m) };
    const sub = createAvatarSubscriber(fakeChannel);
    
    sub(evt('session-start'));
    
    expect(calls.length).toBe(1);
  });

  it('AC 16: Returns undefined (void)', () => {
    const fakeChannel: DeliveryChannel = { kind: 'visual', deliver: () => {} };
    const sub = createAvatarSubscriber(fakeChannel);
    const result = sub(evt('session-start'));
    
    expect(result).toBeUndefined();
  });
});
