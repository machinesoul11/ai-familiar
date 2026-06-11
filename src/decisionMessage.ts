import type { RoutedEvent } from './bus.js';
import type { ChannelMessage, SpokenMessage } from './channel.js';

export const NEEDS_PERMISSION_LINE = 'The agent needs your permission to continue.';
export const NEEDS_INPUT_LINE = 'The agent is waiting for your input.';
export const RUN_STARTED_LINE = 'The agent started working.';

export function decisionMessage(routed: RoutedEvent): ChannelMessage | null {
  if (routed.decision.reason === 'needs-permission') {
    return spokenMessage(notificationText(routed) ?? NEEDS_PERMISSION_LINE);
  }

  if (routed.decision.reason === 'needs-input') {
    return spokenMessage(notificationText(routed) ?? NEEDS_INPUT_LINE);
  }

  if (routed.decision.reason === 'run-started') {
    return spokenMessage(RUN_STARTED_LINE);
  }

  return null;
}

function notificationText(routed: RoutedEvent): string | null {
  if (routed.event.kind !== 'notification') {
    return null;
  }

  const text = routed.event.message.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function spokenMessage(text: string): SpokenMessage {
  return { kind: 'spoken', text };
}
