import type { RoutedEvent } from './bus.js';
import type { AvatarThoughtMessage } from './channel.js';
import { decisionMessage } from './decisionMessage.js';
import { shapeRecap } from './shaper.js';
import type { ArchSummary } from './summary.js';

export function recapThought(
  summary: ArchSummary,
  finalMessage: string | null,
): AvatarThoughtMessage {
  return { kind: 'avatar-thought', text: shapeRecap({ summary, finalMessage }).spokenLine };
}

export function decisionThought(routed: RoutedEvent): AvatarThoughtMessage | null {
  const message = decisionMessage(routed);
  return message !== null && message.kind === 'spoken'
    ? { kind: 'avatar-thought', text: message.text }
    : null;
}
