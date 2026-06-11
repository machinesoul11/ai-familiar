import type { AvatarStateMessage } from './channel.js';
import type { NormalizedEvent } from './normalize.js';

// Project one normalized daemon event to the avatar lifecycle state.
export function avatarMessage(event: NormalizedEvent): AvatarStateMessage | null {
  switch (event.kind) {
    case 'session-start':
    case 'subagent-finished':
      return { kind: 'avatar-state', phase: 'working', ready: false };
    case 'notification':
      return { kind: 'avatar-state', phase: 'blocked', ready: false };
    case 'run-finished':
      return { kind: 'avatar-state', phase: 'done', ready: true };
    case 'session-end':
      return { kind: 'avatar-state', phase: 'idle', ready: false };
    case 'unknown':
      return null;
  }
}
