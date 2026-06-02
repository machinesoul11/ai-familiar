// Seam #3 - the delivery Channel. The router (Phase 3.4) targets channels by `kind`, not devices.
// TTS (3.2), OS notification (3.3), and the avatar (4.1) are all DeliveryChannels.
// Deliberately excludes 'none' (a non-delivery routing decision is not a channel).
export type ChannelKind = 'audio' | 'notification' | 'visual';

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

// --- Avatar protocol (4.1) - renderer-agnostic SEMANTIC tokens; the renderer maps token -> model state. ---

// What the agent is doing now (drives the avatar's activity animation in the renderer).
export type AvatarPhase = 'idle' | 'working' | 'blocked' | 'done';

// Semantic mood (the renderer maps it to a concrete model expression - NOT mapped here).
export type AvatarMood = 'neutral' | 'happy' | 'thinking' | 'alert';

// Base command: the agent's lifecycle phase + an orthogonal attention beacon.
// `ready` is the daemon's "your turn" flag (brain decides it), distinct from the phase animation.
export interface AvatarStateMessage {
  kind: 'avatar-state';
  phase: AvatarPhase;
  ready: boolean;
}

// Semantic mood update (the unspoken twin of mood -> expression mapping happens in the renderer).
export interface AvatarExpressionMessage {
  kind: 'avatar-expression';
  mood: AvatarMood;
}

// Inner-thoughts: text the avatar SHOWS but never speaks (the silent twin of SpokenMessage; 4.3 displays it).
export interface AvatarThoughtMessage {
  kind: 'avatar-thought';
  text: string;
}

export type ChannelMessage =
  | SpokenMessage
  | NotificationMessage
  | AvatarStateMessage
  | AvatarExpressionMessage
  | AvatarThoughtMessage;

export interface DeliveryChannel {
  readonly kind: ChannelKind;
  deliver(message: ChannelMessage): void;
}
