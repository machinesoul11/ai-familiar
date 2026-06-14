import { shapeRecap } from './shaper.js';
import type { ArchSummary } from './summary.js';
import type { Dispatcher } from './dispatch.js';
import type { SpokenMessage } from './channel.js';
import type { RecapLang } from './recapLang.js';

export function createRecapDelivery(
  dispatch: Dispatcher,
  lang: RecapLang = 'en',
): (summary: ArchSummary, finalMessage?: string | null, subagentCount?: number) => void {
  return (
    summary: ArchSummary,
    finalMessage: string | null = null,
    subagentCount?: number,
  ): void => {
    const recap = shapeRecap({ summary, finalMessage, subagentCount, lang });
    const message: SpokenMessage = { kind: 'spoken', text: recap.spokenLine };

    dispatch('notification', message);
  };
}
