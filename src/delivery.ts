import { createElevenLabsBackend } from './elevenLabsBackend.js';
import { createSayBackend } from './sayBackend.js';
import { createTtsChannel } from './ttsChannel.js';
import { createDecisionDelivery } from './decisionDelivery.js';
import { createDispatcher } from './dispatch.js';
import { createRecapDelivery } from './recapDelivery.js';
import { resolveTtsConfig } from './ttsConfig.js';
import type { DecisionSink } from './bus.js';
import type { ArchSummary } from './summary.js';

export function createDelivery(): {
  deliverRecap: (summary: ArchSummary, finalMessage: string | null) => void;
  decisionSink: DecisionSink;
} {
  const tts = resolveTtsConfig(process.env);
  const backend = tts.provider === 'elevenlabs' ? createElevenLabsBackend(tts.elevenLabs!) : createSayBackend();
  const dispatch = createDispatcher([createTtsChannel(backend)]);

  return {
    deliverRecap: createRecapDelivery(dispatch),
    decisionSink: createDecisionDelivery(dispatch),
  };
}
