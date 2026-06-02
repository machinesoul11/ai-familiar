import { join } from 'node:path';
import { createTtsChannel } from '../ttsChannel.js';
import { createDispatcher } from '../dispatch.js';
import { createElevenLabsBackend } from '../elevenLabsBackend.js';
import { createSayBackend } from '../sayBackend.js';
import { resolveTtsConfig } from '../ttsConfig.js';
import { resolveStateRootFromEnv } from '../daemon.js';
import { createPullRecap } from '../pullRecap.js';
import { parseSnapshot } from '../recapSnapshot.js';
import { readSnapshotFile } from '../recapSnapshotStore.js';

function main(): void {
  const stateRoot = resolveStateRootFromEnv(process.env);
  for (const p of [join(process.cwd(), '.env'), join(stateRoot, '.env')]) {
    try {
      process.loadEnvFile(p);
    } catch {
      // Missing or unreadable env files are ignored.
    }
  }

  const tts = resolveTtsConfig(process.env);
  const backend = tts.provider === 'elevenlabs' ? createElevenLabsBackend(tts.elevenLabs!) : createSayBackend();
  const dispatch = createDispatcher([createTtsChannel(backend)]);
  const pull = createPullRecap({
    loadSnapshot: () => parseSnapshot(readSnapshotFile(stateRoot)),
    dispatch,
    emit: (text) => console.log(text),
  });

  pull();
}

try {
  main();
} catch {
  // The hotkey edge is best-effort.
}
