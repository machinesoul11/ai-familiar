import type { AvatarMood, AvatarPhase, ChannelMessage, DeliveryChannel } from './channel.js';

export type AvatarCommand =
  | { kind: 'state'; phase: AvatarPhase; ready: boolean }
  | { kind: 'expression'; mood: AvatarMood }
  | { kind: 'thought'; text: string };

export interface AvatarBackend {
  render(command: AvatarCommand): void;
}

const AVATAR_MESSAGE_KINDS = Object.freeze(new Set(['avatar-state', 'avatar-expression', 'avatar-thought']));
const AVATAR_PHASES = Object.freeze(new Set<AvatarPhase>(['idle', 'working', 'blocked', 'done']));
const AVATAR_MOODS = Object.freeze(new Set<AvatarMood>(['neutral', 'happy', 'thinking', 'alert']));

export function createAvatarChannel(backend: AvatarBackend): DeliveryChannel {
  return {
    kind: 'visual',
    deliver(message: ChannelMessage): void {
      if (!AVATAR_MESSAGE_KINDS.has(message.kind)) {
        return;
      }

      let command: AvatarCommand;
      if (message.kind === 'avatar-state') {
        const phase = message.phase;
        if (!AVATAR_PHASES.has(phase)) {
          return;
        }
        command = { kind: 'state', phase, ready: message.ready === true };
      } else if (message.kind === 'avatar-expression') {
        const mood = message.mood;
        if (!AVATAR_MOODS.has(mood)) {
          return;
        }
        command = { kind: 'expression', mood };
      } else if (message.kind === 'avatar-thought') {
        const text = message.text;
        if (typeof text !== 'string' || text.trim() === '') {
          return;
        }
        command = { kind: 'thought', text };
      } else {
        return;
      }

      try {
        backend.render(command);
      } catch {
        // Delivery channels are fire-and-forget and must not crash callers.
      }
    }
  };
}
