import { shapeRecap } from './shaper.js';
import type { ArchSummary } from './summary.js';
import type { Dispatcher } from './dispatch.js';
import type { SpokenMessage } from './channel.js';
import type { Summarizer } from './shaper.js';

export function createRecapDelivery(
  dispatch: Dispatcher,
  summarizer?: Summarizer,
): (summary: ArchSummary, finalMessage?: string | null) => void {
  return (summary: ArchSummary, finalMessage: string | null = null): void => {
    const recap = shapeRecap({ summary, finalMessage, summarizer });
    const message: SpokenMessage = { kind: 'spoken', text: recap.spokenLine };

    dispatch('notification', message);
  };
}
