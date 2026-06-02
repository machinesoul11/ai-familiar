import { shapeRecap } from './shaper.js';
import type { ArchSummary } from './summary.js';
import type { Dispatcher } from './dispatch.js';
import type { SpokenMessage } from './channel.js';

export function createRecapDelivery(dispatch: Dispatcher): (summary: ArchSummary) => void {
  return (summary: ArchSummary): void => {
    const recap = shapeRecap({ summary, finalMessage: null });
    const message: SpokenMessage = { kind: 'spoken', text: recap.spokenLine };

    dispatch('notification', message);
  };
}
