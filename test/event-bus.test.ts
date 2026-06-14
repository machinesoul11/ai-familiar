import { describe, it, expect, vi } from 'vitest';
import { createEventSink, createRouterSubscriber, createRoutingSubscriber } from '../src/bus.js';
import type { EventSubscriber, DecisionSink, RoutedEvent } from '../src/bus.js';
import { normalize } from '../src/normalize.js';
import type { RawHookEvent } from '../src/daemon.js';
import type { Rule } from '../src/router.js';

describe('Event Bus (src/bus.ts)', () => {
  const createRawEvent = (hook: string, payload: object = {}): RawHookEvent => ({
    v: 1,
    hook,
    sessionId: 'session-1',
    ts: new Date().toISOString(),
    payload
  });

  describe('Acceptance Criterion 13: Bus Fan-out & Single Normalization', () => {
    it('calls normalize once and fans out to all subscribers in order', () => {
      const raw = createRawEvent('Stop');
      const eventsReceived: any[] = [];
      
      const sub1: EventSubscriber = (ev) => {
        eventsReceived.push({ id: 1, ev });
      };
      const sub2: EventSubscriber = (ev) => {
        eventsReceived.push({ id: 2, ev });
      };

      const sink = createEventSink([sub1, sub2]);
      sink(raw);

      expect(eventsReceived).toHaveLength(2);
      expect(eventsReceived[0].id).toBe(1);
      expect(eventsReceived[1].id).toBe(2);

      const expected = normalize(raw);
      expect(eventsReceived[0].ev).toEqual(expected);
      expect(eventsReceived[1].ev).toEqual(expected);

      // Verify they received the EXACT same object instance (proving single normalization)
      expect(eventsReceived[0].ev).toBe(eventsReceived[1].ev);
    });
  });

  describe('Acceptance Criterion 14: Bus Error Isolation', () => {
    it('does not stop subsequent subscribers if one throws, and does not propagate', () => {
      const raw = createRawEvent('Stop');
      let sub2Called = false;

      const sub1: EventSubscriber = () => {
        throw new Error('Subscriber A failed');
      };
      const sub2: EventSubscriber = () => {
        sub2Called = true;
      };

      const sink = createEventSink([sub1, sub2]);

      expect(() => sink(raw)).not.toThrow();
      expect(sub2Called).toBe(true);
    });
  });

  describe('Acceptance Criterion 15: Router Subscriber', () => {
    it('calls emit with formatDecision(event, route(event, rules))', () => {
      const emit = vi.fn();
      const sub = createRouterSubscriber({ emit });
      
      // NormalizedEvent for 'Stop' (run-finished)
      const event = normalize(createRawEvent('Stop'));
      
      sub(event);

      // Default rules for 'run-finished' -> { channel: 'notification', reason: 'run-finished' }
      // formatDecision -> 'would notify: run-finished (Stop)'
      expect(emit).toHaveBeenCalledWith('would notify: run-finished (Stop)');
    });

    it('honors custom rules', () => {
      const emit = vi.fn();
      const customRule: Rule = {
        name: 'custom',
        evaluate: () => ({ channel: 'audio', reason: 'custom-audio' })
      };
      
      const sub = createRouterSubscriber({ rules: [customRule], emit });
      const event = normalize(createRawEvent('Stop'));

      sub(event);

      expect(emit).toHaveBeenCalledWith('ambient: custom-audio (Stop)');
    });

    it('uses console.log as default emit', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const sub = createRouterSubscriber();
      const event = normalize(createRawEvent('Stop'));

      sub(event);

      expect(spy).toHaveBeenCalledWith('would notify: run-finished (Stop)');
      spy.mockRestore();
    });
  });

  describe('Acceptance Criterion 15 (6.2): createRoutingSubscriber rulesFor', () => {
    it('routes each event by the set returned for that event', () => {
      const ruleA: Rule = { name: 'A', evaluate: () => ({ channel: 'audio', reason: 'A' }) };
      const ruleB: Rule = { name: 'B', evaluate: () => ({ channel: 'notification', reason: 'B' }) };
      
      let callCount = 0;
      const rulesFor = vi.fn(() => {
        callCount++;
        return callCount === 1 ? [ruleA] : [ruleB];
      });

      const decisions: RoutedEvent[] = [];
      const sink: DecisionSink = (routed) => decisions.push(routed);

      const sub = createRoutingSubscriber({ rulesFor, sinks: [sink] });

      const ev1 = normalize(createRawEvent('Start'));
      const ev2 = normalize(createRawEvent('Stop'));

      sub(ev1);
      sub(ev2);

      expect(rulesFor).toHaveBeenCalledTimes(2);
      expect(decisions).toHaveLength(2);
      expect(decisions[0].decision).toEqual({ channel: 'audio', reason: 'A' });
      expect(decisions[1].decision).toEqual({ channel: 'notification', reason: 'B' });
    });

    it('matches existing rules behavior when rulesFor is omitted', () => {
      const customRule: Rule = { name: 'C', evaluate: () => ({ channel: 'audio', reason: 'C' }) };

      const decisions: RoutedEvent[] = [];
      const sink: DecisionSink = (routed) => decisions.push(routed);

      const sub = createRoutingSubscriber({ rules: [customRule], sinks: [sink] });
      const ev = normalize(createRawEvent('Stop'));
      sub(ev);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toEqual({ channel: 'audio', reason: 'C' });
    });
  });
});
