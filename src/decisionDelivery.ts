import type { DecisionSink, RoutedEvent } from './bus.js';
import type { ChannelMessage } from './channel.js';
import { decisionMessage } from './decisionMessage.js';
import type { Dispatcher } from './dispatch.js';

export function createDecisionDelivery(
  dispatch: Dispatcher,
  mapMessage: (routed: RoutedEvent) => ChannelMessage | null = decisionMessage,
): DecisionSink {
  return (routed) => {
    const msg = mapMessage(routed);
    if (msg !== null) {
      dispatch(routed.decision.channel, msg);
    }
  };
}
