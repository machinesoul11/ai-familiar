import type { Channel } from './router.js';
import type { ChannelKind, ChannelMessage, DeliveryChannel } from './channel.js';

export type Dispatcher = (target: Channel, message: ChannelMessage) => void;

export function createDispatcher(channels: DeliveryChannel[]): Dispatcher {
  const byKind = new Map<ChannelKind, DeliveryChannel>();

  for (const channel of channels) {
    byKind.set(channel.kind, channel);
  }

  return (target: Channel, message: ChannelMessage): void => {
    const kind = resolveChannel(target);

    if (kind === null) {
      return;
    }

    const channel = byKind.get(kind);

    if (channel === undefined) {
      return;
    }

    channel.deliver(message);
  };
}

function resolveChannel(target: Channel): ChannelKind | null {
  if (target === 'none') {
    return null;
  }

  if (target === 'notification') {
    return 'audio';
  }

  return 'audio';
}
