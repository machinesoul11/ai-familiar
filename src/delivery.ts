import { createSayBackend } from './sayBackend.js';
import { createTtsChannel } from './ttsChannel.js';
import { createDispatcher } from './dispatch.js';
import { createRecapDelivery } from './recapDelivery.js';
import type { ArchSummary } from './summary.js';

export function createDelivery(): { deliverRecap: (summary: ArchSummary) => void } {
  const dispatch = createDispatcher([createTtsChannel(createSayBackend())]);

  return { deliverRecap: createRecapDelivery(dispatch) };
}
