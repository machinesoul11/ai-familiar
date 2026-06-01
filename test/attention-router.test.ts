import { describe, it, expect } from 'vitest';
import { route, defaultRules, formatDecision } from '../src/router.js';
import type { Channel, Rule, RuleVerdict, RouteDecision } from '../src/router.js';
import type { NormalizedEvent, EventKind } from '../src/normalize.js';

/**
 * Fixture builder for NormalizedEvent
 */
function createEvent(kind: EventKind, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const base = {
    v: 1 as const,
    kind,
    hook: 'TestHook',
    sessionId: 'session-123',
    ts: new Date().toISOString(),
    raw: {
      v: 1 as const,
      hook: 'TestHook',
      sessionId: 'session-123',
      ts: new Date().toISOString(),
      payload: {}
    }
  };

  switch (kind) {
    case 'session-start':
      return { ...base, kind, source: 'test-source', ...overrides } as NormalizedEvent;
    case 'notification':
      return { ...base, kind, message: 'test message', ...overrides } as NormalizedEvent;
    case 'session-end':
      return { ...base, kind, reason: 'finished', ...overrides } as NormalizedEvent;
    default:
      return { ...base, kind, ...overrides } as NormalizedEvent;
  }
}

describe('Attention Router (src/router.ts)', () => {
  describe('Acceptance Criteria 1-5: Default Routing Table', () => {
    const table: Array<{ kind: EventKind; message?: string; expected: RouteDecision }> = [
      {
        kind: 'run-finished',
        expected: { channel: 'notification', reason: 'run-finished' }
      },
      {
        kind: 'notification',
        message: 'needs permission to run',
        expected: { channel: 'notification', reason: 'needs-permission' }
      },
      {
        kind: 'notification',
        message: 'PERMISSION REQUIRED',
        expected: { channel: 'notification', reason: 'needs-permission' }
      },
      {
        kind: 'notification',
        message: 'just some input',
        expected: { channel: 'notification', reason: 'needs-input' }
      },
      {
        kind: 'notification',
        message: '',
        expected: { channel: 'notification', reason: 'needs-input' }
      },
      {
        kind: 'subagent-finished',
        expected: { channel: 'audio', reason: 'subagent-progress' }
      },
      {
        kind: 'session-start',
        expected: { channel: 'none', reason: 'silent' }
      },
      {
        kind: 'session-end',
        expected: { channel: 'none', reason: 'silent' }
      },
      {
        kind: 'unknown',
        expected: { channel: 'none', reason: 'silent' }
      }
    ];

    it.each(table)('routes $kind (message: $message) correctly', ({ kind, message, expected }) => {
      const event = createEvent(kind, message !== undefined ? { message } : {});
      const decision = route(event);
      expect(decision).toEqual(expected);
    });
  });

  describe('Acceptance Criteria 6-8: Engine Semantics (Synthetic Rules)', () => {
    const audioRule: Rule = {
      name: 'audio-rule',
      evaluate: () => ({ channel: 'audio', reason: 'audio-reason' })
    };
    const notifyRule: Rule = {
      name: 'notify-rule',
      evaluate: () => ({ channel: 'notification', reason: 'notify-reason' })
    };
    const noneRule: Rule = {
      name: 'none-rule',
      evaluate: () => ({ channel: 'none', reason: 'none-reason' })
    };
    const abstainRule: Rule = {
      name: 'abstain-rule',
      evaluate: () => null
    };

    it('Criterion 6: Precedence - notification beats audio regardless of order', () => {
      const event = createEvent('unknown');
      
      // Order: Audio then Notification
      expect(route(event, [audioRule, notifyRule])).toEqual({
        channel: 'notification',
        reason: 'notify-reason'
      });

      // Order: Notification then Audio
      expect(route(event, [notifyRule, audioRule])).toEqual({
        channel: 'notification',
        reason: 'notify-reason'
      });
    });

    it('Criterion 7: Tie-break - earliest rule wins for same channel', () => {
      const event = createEvent('unknown');
      const notifyRule2: Rule = {
        name: 'notify-rule-2',
        evaluate: () => ({ channel: 'notification', reason: 'notify-reason-2' })
      };

      expect(route(event, [notifyRule, notifyRule2])).toEqual({
        channel: 'notification',
        reason: 'notify-reason'
      });

      expect(route(event, [notifyRule2, notifyRule])).toEqual({
        channel: 'notification',
        reason: 'notify-reason-2'
      });
    });

    it('Criterion 8: Abstain & Empty - null skipped, empty/all-abstain returns silent', () => {
      const event = createEvent('unknown');
      
      // Abstain followed by audio
      expect(route(event, [abstainRule, audioRule])).toEqual({
        channel: 'audio',
        reason: 'audio-reason'
      });

      // Empty
      expect(route(event, [])).toEqual({
        channel: 'none',
        reason: 'silent'
      });

      // All abstain
      expect(route(event, [abstainRule, abstainRule])).toEqual({
        channel: 'none',
        reason: 'silent'
      });
    });
  });

  describe('Acceptance Criteria 9-10: Totality, Determinism, Purity', () => {
    it('Criterion 9: Totality - never throws and returns valid decision for all kinds', () => {
      const kinds: EventKind[] = ['session-start', 'run-finished', 'subagent-finished', 'notification', 'session-end', 'unknown'];
      
      for (const kind of kinds) {
        const event = createEvent(kind, {
          hook: '', // Adversarial
          ts: 'not-a-date',
          sessionId: '!!!'
        });
        
        let decision: RouteDecision;
        expect(() => {
          decision = route(event);
        }).not.toThrow();

        // @ts-ignore - checking runtime validity
        expect(['notification', 'audio', 'none']).toContain(decision!.channel);
        expect(typeof decision!.reason).toBe('string');
      }
    });

    it('Criterion 10: Determinism & No Mutation', () => {
      const event = createEvent('notification', { message: 'permission' });
      const rules = [...defaultRules];
      const eventJson = JSON.stringify(event);
      const rulesJson = JSON.stringify(rules);

      const d1 = route(event, rules);
      const d2 = route(event, rules);

      expect(d1).toEqual(d2);
      expect(JSON.stringify(event)).toBe(eventJson);
      expect(JSON.stringify(rules)).toBe(rulesJson);
    });
  });

  describe('Acceptance Criterion 11: defaultRules is Composable', () => {
    it('allows adding an extra rule', () => {
      const extraRule: Rule = {
        name: 'extra',
        evaluate: (ev) => ev.kind === 'session-start' ? { channel: 'notification', reason: 'surprise' } : null
      };

      const event = createEvent('session-start');
      
      // Default behavior
      expect(route(event, defaultRules).channel).toBe('none');

      // Composed behavior
      expect(route(event, [...defaultRules, extraRule])).toEqual({
        channel: 'notification',
        reason: 'surprise'
      });
    });

    it('allows removing a rule', () => {
      const event = createEvent('run-finished');
      
      // Default behavior
      expect(route(event, defaultRules).channel).toBe('notification');

      // Filtered rules
      const filteredRules = defaultRules.filter(r => r.name !== 'run-finished');
      expect(route(event, filteredRules).channel).toBe('none');
    });
  });

  describe('Acceptance Criterion 12: formatDecision', () => {
    const table: Array<{ channel: Channel; reason: string; hook: string; expected: string }> = [
      {
        channel: 'notification',
        reason: 'run-finished',
        hook: 'Stop',
        expected: 'would notify: run-finished (Stop)'
      },
      {
        channel: 'audio',
        reason: 'subagent-progress',
        hook: 'SubagentStop',
        expected: 'ambient: subagent-progress (SubagentStop)'
      },
      {
        channel: 'none',
        reason: 'silent',
        hook: 'SessionStart',
        expected: 'silent: silent (SessionStart)'
      },
      {
        channel: 'notification',
        reason: 'needs-permission',
        hook: 'Notification',
        expected: 'would notify: needs-permission (Notification)'
      }
    ];

    it.each(table)('formats $channel correctly', ({ channel, reason, hook, expected }) => {
      const event = createEvent('unknown', { hook });
      const decision: RouteDecision = { channel, reason };
      expect(formatDecision(event, decision)).toBe(expected);
    });
  });

  it('Type-level check: Rule and RouteDecision', () => {
    const decision: RouteDecision = { channel: 'none', reason: 'test' };
    expect(decision.channel).toBeDefined();

    const rule: Rule = {
      name: 'test-rule',
      evaluate: (ev: NormalizedEvent) => ({ channel: 'none', reason: 'ok' })
    };
    expect(rule.name).toBe('test-rule');
  });
});
