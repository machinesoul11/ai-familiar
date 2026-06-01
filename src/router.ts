import type { NormalizedEvent } from './normalize.js';

export type Channel = 'notification' | 'audio' | 'none';

export interface RuleVerdict {
  channel: Channel;
  reason: string;
}

export type RouteDecision = RuleVerdict;

export interface Rule {
  readonly name: string;
  evaluate(event: NormalizedEvent): RuleVerdict | null;
}

const channelPrecedence: Record<Channel, number> = {
  notification: 2,
  audio: 1,
  none: 0,
};

export const defaultRules: Rule[] = [
  {
    name: 'run-finished',
    evaluate(event) {
      return event.kind === 'run-finished'
        ? { channel: 'notification', reason: 'run-finished' }
        : null;
    },
  },
  {
    name: 'notification',
    evaluate(event) {
      if (event.kind !== 'notification') {
        return null;
      }

      const reason = event.message.toLowerCase().includes('permission')
        ? 'needs-permission'
        : 'needs-input';

      return { channel: 'notification', reason };
    },
  },
  {
    name: 'subagent-finished',
    evaluate(event) {
      return event.kind === 'subagent-finished'
        ? { channel: 'audio', reason: 'subagent-progress' }
        : null;
    },
  },
];

export function route(
  event: NormalizedEvent,
  rules: Rule[] = defaultRules,
): RouteDecision {
  let decision: RouteDecision | undefined;
  let bestPrecedence = -1;

  for (const rule of rules) {
    const verdict = rule.evaluate(event);
    if (!verdict) {
      continue;
    }

    const precedence = channelPrecedence[verdict.channel];
    if (precedence > bestPrecedence) {
      decision = verdict;
      bestPrecedence = precedence;
    }
  }

  return decision ?? { channel: 'none', reason: 'silent' };
}

export function formatDecision(
  event: NormalizedEvent,
  decision: RouteDecision,
): string {
  const label = decision.channel === 'notification'
    ? 'would notify'
    : decision.channel === 'audio'
      ? 'ambient'
      : 'silent';

  return `${label}: ${decision.reason} (${event.hook})`;
}
