import { join } from 'node:path';
import { createTtsChannel } from '../ttsChannel.js';
import { createDispatcher } from '../dispatch.js';
import { createElevenLabsBackend } from '../elevenLabsBackend.js';
import { createSayBackend } from '../sayBackend.js';
import { resolveStateRootFromEnv } from '../daemon.js';
import { createDecisionLedger } from '../ledger.js';
import { createRecall } from '../recall.js';
import { loadEffectiveConfig } from '../effectiveConfig.js';

async function main(): Promise<void> {
  const stateRoot = resolveStateRootFromEnv(process.env);
  for (const p of [join(process.cwd(), '.env'), join(stateRoot, '.env')]) {
    try {
      process.loadEnvFile(p);
    } catch {
      // Missing or unreadable env files are ignored.
    }
  }

  const tts = loadEffectiveConfig(process.env, stateRoot).tts;
  const backend = tts.provider === 'elevenlabs' ? createElevenLabsBackend(tts.elevenLabs!) : createSayBackend();
  const dispatch = createDispatcher([createTtsChannel(backend)]);
  const ledger = createDecisionLedger();
  const sessionId = sessionArg(process.argv) ?? ledger.recent(1)[0]?.sessionId;
  const recall = createRecall({
    loadRows: () => sessionId ? ledger.bySession(sessionId) : [],
    dispatch,
    emit: (text) => console.log(text),
  });

  recall();
  await ledger.close();
}

function sessionArg(argv: string[]): string | undefined {
  const index = argv.indexOf('--session');
  return index === -1 ? undefined : argv[index + 1];
}

try {
  await main();
} catch {
  // The hotkey edge is best-effort.
}
