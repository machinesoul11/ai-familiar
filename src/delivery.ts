import { createElevenLabsBackend } from './elevenLabsBackend.js';
import { createSayBackend } from './sayBackend.js';
import { createSerializedBackend } from './serializedBackend.js';
import { createTtsChannel } from './ttsChannel.js';
import { createDecisionDelivery } from './decisionDelivery.js';
import { createDispatcher } from './dispatch.js';
import { createRecapDelivery } from './recapDelivery.js';
import { resolveTtsConfig } from './ttsConfig.js';
import type { Dispatcher } from './dispatch.js';
import type { DecisionSink } from './bus.js';
import type { ArchSummary } from './summary.js';

export function createDelivery(): {
  deliverRecap: (summary: ArchSummary, finalMessage: string | null) => void;
  decisionSink: DecisionSink;
  dispatch: Dispatcher;
} {
  const tts = resolveTtsConfig(process.env);
  const backend = tts.provider === 'elevenlabs' ? createElevenLabsBackend(tts.elevenLabs!) : createSayBackend();
  const dispatch = createDispatcher([createTtsChannel(createSerializedBackend(backend))]);

  // The same single audio stack is shared across consumers: the deferred recap,
  // the live needs-you decision sink, and now (4.4) the on-demand pull-recap the
  // touch channel triggers. Exposing the dispatcher avoids spinning a second TTS
  // backend just to replay the snapshot.
  return {
    deliverRecap: createRecapDelivery(dispatch),
    decisionSink: createDecisionDelivery(dispatch),
    dispatch,
  };
}
