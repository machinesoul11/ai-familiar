import type { ChannelMessage, DeliveryChannel } from './channel.js';

export interface SpeechBackend {
  speak(text: string): void;
}

export function createTtsChannel(backend: SpeechBackend): DeliveryChannel {
  return {
    kind: 'audio',
    deliver(message: ChannelMessage): void {
      if (message.kind !== 'spoken') {
        return;
      }

      const text = message.text;
      if (typeof text !== 'string' || text.trim() === '') {
        return;
      }

      try {
        backend.speak(text);
      } catch {
        // Delivery channels are fire-and-forget and must not crash callers.
      }
    }
  };
}
