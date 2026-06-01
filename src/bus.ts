import type { RawHookEvent } from './daemon.js';
import { normalize, type NormalizedEvent } from './normalize.js';
import {
  formatDecision,
  route,
  type Rule,
} from './router.js';

export type EventSubscriber = (event: NormalizedEvent) => void;

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
  const emit = opts.emit ?? console.log;

  return (event) => {
    const decision = route(event, opts.rules);
    emit(formatDecision(event, decision));
  };
}
