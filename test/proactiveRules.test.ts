import { describe, it, expect } from 'vitest';
import { route } from '../src/router.js';
import { resolveProactiveEnabled, proactiveRules, resolveRules, rulesForProactive } from '../src/proactiveRules.js';

describe('proactiveRules', () => {
  it('AC1: resolveProactiveEnabled(env)', () => {
    // Truthy cases (case-insensitive, trimmed)
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: '1' })).toBe(true);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: 'true' })).toBe(true);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: 'YES' })).toBe(true);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: '  on  ' })).toBe(true);

    // Falsy cases
    expect(resolveProactiveEnabled({})).toBe(false);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: '' })).toBe(false);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: '0' })).toBe(false);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: 'false' })).toBe(false);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: 'off' })).toBe(false);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: 'no' })).toBe(false);
    expect(resolveProactiveEnabled({ FAMILIAR_PROACTIVE: 'arbitrary' })).toBe(false);
  });

  it('AC2: proactiveRules has EXACTLY ONE rule named proactive-run-started', () => {
    expect(proactiveRules).toHaveLength(1);
    const rule = proactiveRules[0];
    expect(rule.name).toBe('proactive-run-started');

    expect(rule.evaluate({ kind: 'session-start' } as any)).toEqual({ channel: 'audio', reason: 'run-started' });
    expect(rule.evaluate({ kind: 'run-finished' } as any)).toBeNull();
    expect(rule.evaluate({ kind: 'subagent-finished' } as any)).toBeNull();
    expect(rule.evaluate({ kind: 'notification' } as any)).toBeNull();
    expect(rule.evaluate({ kind: 'session-end' } as any)).toBeNull();
    expect(rule.evaluate({ kind: 'unknown' } as any)).toBeNull();
  });

  it('AC3: resolveRules({FAMILIAR_PROACTIVE: "0"}) via route()', () => {
    const rules = resolveRules({ FAMILIAR_PROACTIVE: '0' });
    
    expect(route({ kind: 'session-start' } as any, rules)).toEqual({ channel: 'none', reason: 'silent' });
    expect(route({ kind: 'subagent-finished' } as any, rules)).toEqual({ channel: 'audio', reason: 'subagent-progress' });
    expect(route({ kind: 'run-finished' } as any, rules)).toEqual({ channel: 'notification', reason: 'run-finished' });
  });

  it('AC4: resolveRules({FAMILIAR_PROACTIVE: "1"}) via route()', () => {
    const rules = resolveRules({ FAMILIAR_PROACTIVE: '1' });
    
    // Proactive rule matches session-start
    expect(route({ kind: 'session-start' } as any, rules)).toEqual({ channel: 'audio', reason: 'run-started' });
    
    // Default rule handles subagent-finished (proactive no longer overrides)
    expect(route({ kind: 'subagent-finished' } as any, rules)).toEqual({ channel: 'audio', reason: 'subagent-progress' });
    
    // Default rule handles run-finished
    expect(route({ kind: 'run-finished' } as any, rules)).toEqual({ channel: 'notification', reason: 'run-finished' });
  });

  it('AC5: proactive rule evaluate never throws on any kind', () => {
    const rule = proactiveRules[0];
    const kinds = [
      'session-start',
      'run-finished',
      'subagent-finished',
      'notification',
      'session-end',
      'unknown'
    ];

    for (const kind of kinds) {
      const event = { kind } as any;
      expect(() => rule.evaluate(event)).not.toThrow();
      
      // Verification of behavior is also good to have
      const result = rule.evaluate(event);
      if (kind === 'session-start') {
        expect(result).toEqual({ channel: 'audio', reason: 'run-started' });
      } else {
        expect(result).toBeNull();
      }
    }
  });

  it('AC16: rulesForProactive(true/false) returns exact arrays', () => {
    const rulesTrue = rulesForProactive(true);
    const rulesFalse = rulesForProactive(false);

    // false -> exactly defaultRules (assuming defaultRules are tested indirectly via resolveRules/route)
    // we know resolveRules(0) gives defaultRules
    const expectedFalse = resolveRules({ FAMILIAR_PROACTIVE: '0' });
    expect(rulesFalse).toEqual(expectedFalse);

    // true -> [...proactiveRules, ...defaultRules]
    expect(rulesTrue).toEqual([...proactiveRules, ...expectedFalse]);
  });
});
