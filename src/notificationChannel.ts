import type { ChannelMessage, DeliveryChannel } from './channel.js';

export interface NotificationBackend {
  notify(title: string, body: string): void;
}

export function createNotificationChannel(backend: NotificationBackend): DeliveryChannel {
  return {
    kind: 'notification',
    deliver(message: ChannelMessage): void {
      if (message.kind !== 'notification') {
        return;
      }

      const title = typeof message.title === 'string' ? message.title : '';
      const body = typeof message.body === 'string' ? message.body : '';
      if (title.trim() === '' && body.trim() === '') {
        return;
      }

      try {
        backend.notify(title, body);
      } catch {
        // Delivery channels are fire-and-forget and must not crash callers.
      }
    }
  };
}
