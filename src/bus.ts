import type { RawHookEvent } from './daemon.js';
import { normalize, type NormalizedEvent } from './normalize.js';
import {
  formatDecision,
  route,
  type RouteDecision,
  type Rule,
} from './router.js';

export type EventSubscriber = (event: NormalizedEvent) => void;

export interface RoutedEvent {
  event: NormalizedEvent;
  decision: RouteDecision;
}

export type DecisionSink = (routed: RoutedEvent) => void;

export function createEventSink(
  subscribers: EventSubscriber[],
): (raw: RawHookEvent) => void {
  return (raw) => {
    const event = normalize(raw);

    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch {
        // Subscriber failures are isolated so later subscribers still receive the event.
      }
    }
  };
}

export function createRouterSubscriber(opts: {
  rules?: Rule[];
  emit?: (line: string) => void;
} = {}): EventSubscriber {
  return createRoutingSubscriber({
    rules: opts.rules,
    sinks: [consoleDecisionSink(opts.emit)],
  });
}

export function createRoutingSubscriber(opts: {
  rules?: Rule[];
  rulesFor?: () => Rule[];
  sinks: DecisionSink[];
}): EventSubscriber {
  return (event) => {
    const rules = opts.rulesFor ? opts.rulesFor() : opts.rules;
    const decision = route(event, rules);
    const routed: RoutedEvent = { event, decision };

    for (const sink of opts.sinks) {
      try {
        sink(routed);
      } catch {
        // Decision sink failures are isolated so later sinks still receive the route.
      }
    }
  };
}

export function consoleDecisionSink(emit?: (line: string) => void): DecisionSink {
  return (routed) => {
    (emit ?? console.log)(formatDecision(routed.event, routed.decision));
  };
}
