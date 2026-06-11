import type { EventSubscriber } from './bus.js';
import type { ChannelMessage, DeliveryChannel } from './channel.js';
import { avatarMessage } from './avatarMessage.js';
import type { NormalizedEvent } from './normalize.js';

export function createAvatarSubscriber(
  channel: DeliveryChannel,
  map?: (event: NormalizedEvent) => ChannelMessage | null,
): EventSubscriber {
  return (event) => {
    const message = (map ?? avatarMessage)(event);
    if (message !== null) {
      channel.deliver(message);
    }
  };
}
