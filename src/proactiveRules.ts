import { defaultRules, type Rule } from './router.js';

const proactiveEnabledValues = new Set(['1', 'true', 'yes', 'on']);

export function resolveProactiveEnabled(env: Record<string, string | undefined>): boolean {
  return proactiveEnabledValues.has(env.FAMILIAR_PROACTIVE?.trim().toLowerCase() ?? '');
}

export const proactiveRules: Rule[] = [
  {
    name: 'proactive-run-started',
    evaluate(event) {
      return event.kind === 'session-start'
        ? { channel: 'audio', reason: 'run-started' }
        : null;
    },
  },
];

export function resolveRules(env: Record<string, string | undefined>): Rule[] {
  return resolveProactiveEnabled(env)
    ? [...proactiveRules, ...defaultRules]
    : defaultRules;
}

export function rulesForProactive(proactive: boolean): Rule[] {
  return proactive ? [...proactiveRules, ...defaultRules] : defaultRules;
}
