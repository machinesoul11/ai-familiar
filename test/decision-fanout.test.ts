import { describe, it, expect, vi } from 'vitest';
import { 
  createRoutingSubscriber, 
  consoleDecisionSink, 
  createRouterSubscriber 
} from '../src/bus.js';
import type { RoutedEvent, DecisionSink } from '../src/bus.js';
import { route, formatDecision } from '../src/router.js';
import { normalize } from '../src/normalize.js';
import type { RawHookEvent } from '../src/daemon.js';

describe('Decision Fan-out (src/bus.ts)', () => {
  const rawStopEvent: RawHookEvent = {
    v: 1,
    hook: 'Stop',
    sessionId: 'session-123',
    ts: '2026-06-01T12:00:00Z',
    payload: {}
  };

  const stopEvent = normalize(rawStopEvent);

  it('Criterion 1: Fans out once + order', () => {
    const log: string[] = [];
    const sinkA: DecisionSink = (routed) => {
      log.push('a');
      expect(routed.event).toBe(stopEvent);
      expect(routed.decision).toEqual(route(stopEvent));
    };
    const sinkB: DecisionSink = (routed) => {
      log.push('b');
      expect(routed.event).toBe(stopEvent);
      expect(routed.decision).toEqual(route(stopEvent));
    };

    const subscriber = createRoutingSubscriber({ sinks: [sinkA, sinkB] });
    subscriber(stopEvent);

    expect(log).toEqual(['a', 'b']);
  });

  it('Criterion 2: Respects custom rules', () => {
    const customRule = {
      name: 'always-none',
      evaluate: () => ({ channel: 'none' as const, reason: 'custom' })
    };
    
    let capturedDecision: any = null;
    const sink: DecisionSink = (routed) => {
      capturedDecision = routed.decision;
    };

    const subscriber = createRoutingSubscriber({ 
      rules: [customRule], 
      sinks: [sink] 
    });
    subscriber(stopEvent);

    expect(capturedDecision).toEqual({ channel: 'none', reason: 'custom' });
    expect(capturedDecision).not.toEqual(route(stopEvent));
  });

  it('Criterion 3: Sink isolation (first sink throws, second still called)', () => {
    const log: string[] = [];
    const throwingSink: DecisionSink = () => {
      log.push('throwing');
      throw new Error('Boom');
    };
    const safeSink: DecisionSink = () => {
      log.push('safe');
    };

    const subscriber = createRoutingSubscriber({ sinks: [throwingSink, safeSink] });
    
    // Should NOT throw
    expect(() => subscriber(stopEvent)).not.toThrow();
    expect(log).toEqual(['throwing', 'safe']);
  });

  describe('consoleDecisionSink', () => {
    it('Criterion 4: calls provided emit once with formatDecision', () => {
      const emit = vi.fn();
      const sink = consoleDecisionSink(emit);
      const decision = route(stopEvent);
      const routed: RoutedEvent = { event: stopEvent, decision };
      
      sink(routed);
      
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(formatDecision(stopEvent, decision));
    });

    it('Criterion 4 (default): defaults to console.log', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const sink = consoleDecisionSink();
      const decision = route(stopEvent);
      const routed: RoutedEvent = { event: stopEvent, decision };
      
      sink(routed);
      
      expect(spy).toHaveBeenCalledWith(formatDecision(stopEvent, decision));
      spy.mockRestore();
    });
  });

  describe('createRouterSubscriber (Regression)', () => {
    it('Criterion 5: emits once with formatted line for run-finished', () => {
      const emit = vi.fn();
      const subscriber = createRouterSubscriber({ emit });
      
      subscriber(stopEvent);
      
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(formatDecision(stopEvent, route(stopEvent)));
    });

    it('Criterion 5: honors custom rules', () => {
      const emit = vi.fn();
      const customRule = {
        name: 'force-audio',
        evaluate: () => ({ channel: 'audio' as const, reason: 'forced' })
      };
      
      const subscriber = createRouterSubscriber({ rules: [customRule], emit });
      subscriber(stopEvent);
      
      const expectedLine = formatDecision(stopEvent, { channel: 'audio', reason: 'forced' });
      expect(emit).toHaveBeenCalledWith(expectedLine);
    });
  });

  it('Criterion 1: routes exactly once regardless of sink count', () => {
    let evalCount = 0;
    const countingRule = {
      name: 'counting',
      evaluate: () => { evalCount++; return { channel: 'audio' as const, reason: 'counted' }; }
    };
    const sink1: DecisionSink = () => {};
    const sink2: DecisionSink = () => {};
    const sink3: DecisionSink = () => {};
    const subscriber = createRoutingSubscriber({ rules: [countingRule], sinks: [sink1, sink2, sink3] });
    subscriber(stopEvent);
    expect(evalCount).toBe(1);
  });
});
