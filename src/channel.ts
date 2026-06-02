// Seam #3 - the delivery Channel. The router (Phase 3.4) targets channels by `kind`, not devices.
// TTS (3.2), OS notification (3.3), and the avatar (4.1) are all DeliveryChannels.
// Deliberately excludes 'none' (a non-delivery routing decision is not a channel).
export type ChannelKind = 'audio' | 'notification';

// A message handed to a channel. Discriminated union; it grows by adding variants.
// Existing channels handle the kinds they know and ignore the rest.
export interface SpokenMessage {
  kind: 'spoken';
  text: string;
}

export interface NotificationMessage {
  kind: 'notification';
  title: string;
  body: string;
}

export type ChannelMessage = SpokenMessage | NotificationMessage;

export interface DeliveryChannel {
  readonly kind: ChannelKind;
  deliver(message: ChannelMessage): void;
}
