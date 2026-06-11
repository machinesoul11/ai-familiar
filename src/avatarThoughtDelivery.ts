import type { DecisionSink, RoutedEvent } from './bus.js';
import type { AvatarThoughtMessage, DeliveryChannel } from './channel.js';
import type { ArchSummary } from './summary.js';
import { decisionThought, recapThought } from './avatarThought.js';

export function createAvatarThoughtRecapEmitter(
  channel: DeliveryChannel,
  map?: (summary: ArchSummary, finalMessage: string | null) => AvatarThoughtMessage | null,
): (summary: ArchSummary, finalMessage: string | null) => void {
  return (summary, finalMessage) => {
    const message = (map ?? recapThought)(summary, finalMessage);
    if (message !== null) {
      channel.deliver(message);
    }
  };
}

export function createAvatarThoughtDecisionSink(
  channel: DeliveryChannel,
  map?: (routed: RoutedEvent) => AvatarThoughtMessage | null,
): DecisionSink {
  return (routed) => {
    const message = (map ?? decisionThought)(routed);
    if (message !== null) {
      channel.deliver(message);
    }
  };
}
