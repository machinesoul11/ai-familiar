import { describe, it, expect } from 'vitest';
import { createRecapDelivery } from '../src/recapDelivery.js';
import type { ArchSummary } from '../src/summary.js';
import type { Dispatcher } from '../src/dispatch.js';
import type { Channel } from '../src/router.js';
import type { ChannelMessage } from '../src/channel.js';

interface DispatchCall {
  target: Channel;
  message: ChannelMessage;
}

describe('Recap Delivery Composer (AC 12-17)', () => {
  it('AC12: createRecapDelivery(fake) returns a function; construction calls dispatch zero times', () => {
    const calls: DispatchCall[] = [];
    const fakeDispatch: Dispatcher = (target, message) => calls.push({ target, message });
    
    const deliverRecap = createRecapDelivery(fakeDispatch);
    
    expect(typeof deliverRecap).toBe('function');
    expect(calls.length).toBe(0);
  });

  it('AC13: Empty summary -> dispatch called once with correct no-changes text', () => {
    const calls: DispatchCall[] = [];
    const deliverRecap = createRecapDelivery((target, message) => calls.push({ target, message }));
    
    const emptySummary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    
    deliverRecap(emptySummary);
    
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification'); // AC16 Target is always notification
    expect(calls[0].message).toEqual({
      kind: 'spoken', // AC16 kind is always spoken
      text: 'Run landed. No architectural changes.'
    });
  });

  it('AC14: 3 modules -> dispatch called with 3 modules changed text', () => {
    const calls: DispatchCall[] = [];
    const deliverRecap = createRecapDelivery((target, message) => calls.push({ target, message }));
    
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [{} as any, {} as any, {} as any],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    
    deliverRecap(summary);
    
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message).toEqual({
      kind: 'spoken',
      text: 'Run landed: 3 modules changed.'
    });
  });

  it('AC15: Full mix v=1, p=2, m=4, c=1 -> byte-exact full-mix line', () => {
    const calls: DispatchCall[] = [];
    const deliverRecap = createRecapDelivery((target, message) => calls.push({ target, message }));
    
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [{} as any, {} as any, {} as any, {} as any], // 4
      newCouplings: [{} as any], // 1
      protectedHits: [{} as any, {} as any], // 2
      violations: [{} as any] // 1
    };
    
    deliverRecap(summary);
    
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message).toEqual({
      kind: 'spoken',
      text: 'Run landed: 1 boundary violation, 2 protected zones touched, 4 modules changed, 1 new cross-module coupling.'
    });
  });

  it('AC16 & AC17: Returns undefined, does not throw for any summary, target/kind constants', () => {
    const calls: DispatchCall[] = [];
    const deliverRecap = createRecapDelivery((target, message) => calls.push({ target, message }));
    
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    
    let result;
    expect(() => {
      result = deliverRecap(summary);
    }).not.toThrow();
    
    expect(result).toBeUndefined();
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message.kind).toBe('spoken');
  });
});