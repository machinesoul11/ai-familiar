import { describe, it, expect } from 'vitest';
import { createRecapDelivery } from '../src/recapDelivery.js';
import type { ArchSummary } from '../src/summary.js';
import type { Dispatcher } from '../src/dispatch.js';
import type { Summarizer, SummarizerInput } from '../src/shaper.js';
import type { Channel, ChannelMessage } from '../src/router.js';

describe('recapDelivery with summarizer', () => {
  const emptySummary: ArchSummary = {
    kind: 'arch-summary',
    modules: [],
    newCouplings: [],
    protectedHits: [],
    violations: []
  };

  const populatedSummary: ArchSummary = {
    kind: 'arch-summary',
    modules: [{}, {}, {}] as any,
    newCouplings: [{}] as any,
    protectedHits: [] as any,
    violations: [] as any
  };

  const expectedDeterministicEmpty = 'Run landed. No architectural changes.';
  const expectedDeterministicPopulated = 'Run landed: 3 modules changed, 1 new cross-module coupling.';

  // AC13
  it("delivers deterministic line with no summarizer and no finalMessage", () => {
    const calls: { target: Channel, message: ChannelMessage }[] = [];
    const dispatch: Dispatcher = (target, message) => calls.push({ target, message });
    
    const deliverRecap = createRecapDelivery(dispatch);
    const result = deliverRecap(populatedSummary);
    
    expect(result).toBeUndefined();
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message).toEqual({ kind: 'spoken', text: expectedDeterministicPopulated });
  });

  // AC14
  it("delivers identical deterministic line with no summarizer even if finalMessage is provided", () => {
    const calls: { target: Channel, message: ChannelMessage }[] = [];
    const dispatch: Dispatcher = (target, message) => calls.push({ target, message });
    
    const deliverRecap = createRecapDelivery(dispatch);
    deliverRecap(populatedSummary, 'agent text');
    
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message).toEqual({ kind: 'spoken', text: expectedDeterministicPopulated });
  });

  // AC15
  it("plumbs summary and finalMessage to summarizer but falls back to deterministic if summarizer returns null", () => {
    const calls: { target: Channel, message: ChannelMessage }[] = [];
    const dispatch: Dispatcher = (target, message) => calls.push({ target, message });
    
    const inputs: SummarizerInput[] = [];
    const summarizer: Summarizer = {
      summarize(input) {
        inputs.push(input);
        return null; // declination
      }
    };
    
    const deliverRecap = createRecapDelivery(dispatch, summarizer);
    deliverRecap(populatedSummary, 'agent final text');
    
    expect(inputs.length).toBe(1);
    expect(inputs[0]).toEqual({ summary: populatedSummary, finalMessage: 'agent final text' });
    
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message).toEqual({ kind: 'spoken', text: expectedDeterministicPopulated });
  });

  // AC16
  it("dispatches the verbatim output of the summarizer if it returns a non-empty string", () => {
    const calls: { target: Channel, message: ChannelMessage }[] = [];
    const dispatch: Dispatcher = (target, message) => calls.push({ target, message });
    
    const summarizer: Summarizer = {
      summarize() {
        return 'CUSTOM SPOKEN LINE';
      }
    };
    
    const deliverRecap = createRecapDelivery(dispatch, summarizer);
    deliverRecap(emptySummary, 'whatever');
    
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message).toEqual({ kind: 'spoken', text: 'CUSTOM SPOKEN LINE' });
  });

  // AC17
  it("normalizes absent finalMessage to null for the summarizer", () => {
    const inputs: SummarizerInput[] = [];
    const summarizer: Summarizer = {
      summarize(input) {
        inputs.push(input);
        return null;
      }
    };
    
    const deliverRecap = createRecapDelivery(() => {}, summarizer);
    
    deliverRecap(emptySummary);
    deliverRecap(emptySummary, undefined);
    deliverRecap(emptySummary, null);
    
    expect(inputs.length).toBe(3);
    expect(inputs[0].finalMessage).toBeNull();
    expect(inputs[1].finalMessage).toBeNull();
    expect(inputs[2].finalMessage).toBeNull();
  });

  // AC18
  it("never throws, always uses 'notification' and 'spoken', and returns undefined", () => {
    const calls: { target: Channel, message: ChannelMessage }[] = [];
    const dispatch: Dispatcher = (target, message) => calls.push({ target, message });
    
    const summarizer: Summarizer = {
      summarize() { return 'A'; }
    };
    
    const deliverRecap = createRecapDelivery(dispatch, summarizer);
    
    let result;
    expect(() => {
      result = deliverRecap(emptySummary, 'B');
    }).not.toThrow();
    
    expect(result).toBeUndefined();
    expect(calls[0].target).toBe('notification');
    expect(calls[0].message.kind).toBe('spoken');
  });
});
