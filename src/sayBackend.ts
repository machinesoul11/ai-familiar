import { spawn, type ChildProcess } from 'node:child_process';
import type { SpeechBackend } from './ttsChannel.js';

export function createSayBackend(): SpeechBackend {
  // The serializer guarantees at most one utterance in flight, so there is at
  // most one live `say` child at a time. We track it so stop() (5.4b barge-in)
  // can kill it mid-sentence.
  let current: ChildProcess | null = null;

  return {
    speak(text: string): Promise<void> {
      return new Promise((resolve) => {
        try {
          const child = spawn('say', [text], {
            detached: true,
            stdio: 'ignore'
          });

          current = child;
          const settle = () => {
            if (current === child) {
              current = null;
            }
            resolve();
          };

          child.once('close', settle);
          child.once('error', settle);
          child.unref();
        } catch {
          // The real OS edge is best-effort; sync spawn failures are swallowed.
          resolve();
        }
      });
    },
    stop(): void {
      // Kill the in-flight child; its close handler clears `current` and resolves
      // the pending speak promise so the serializer's pump advances over the
      // (already-flushed) queue and idles. Never throws.
      if (current) {
        try {
          current.kill('SIGTERM');
        } catch {
          // Best-effort; a failed kill leaves the child to finish on its own.
        }
      }
    }
  };
}
