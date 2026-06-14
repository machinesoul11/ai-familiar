import { createConnection } from 'node:net';
import { join } from 'node:path';
import { resolveStateRootFromEnv } from '../daemon.js';

// Stop / barge-in CLI (5.4b). Bind this to a system hotkey (Raycast/skhd/etc.)
// to silence Familiar mid-sentence. It writes the trusted, fixed-vocabulary
// `stop` intent to the daemon's upstream intent.sock — the same frame the
// avatar's ⌃⌥⌘S chord emits — and exits. The daemon flushes its shared audio
// queue and kills the in-flight say/afplay child.
//
// Works even when the avatar overlay isn't running: the daemon owns the audio,
// so this needs only the daemon. Fire-and-forget, no ack; if the daemon is down
// the connect fails and it's a silent no-op (nothing is playing anyway). No user
// text, so no JSON escaping (mirrors the Swift emit(intent:) path).
const STOP_FRAME = '{"kind":"avatar-intent","intent":"stop"}\n';

function main(): void {
  const stateRoot = resolveStateRootFromEnv(process.env);
  const socketPath = join(stateRoot, 'intent.sock');

  const client = createConnection(socketPath);
  client.once('connect', () => {
    client.end(STOP_FRAME);
  });
  client.once('error', () => {
    // Daemon down / no socket: barge-in is moot, exit quietly.
    client.destroy();
  });
}

try {
  main();
} catch {
  // The hotkey edge is best-effort.
}
