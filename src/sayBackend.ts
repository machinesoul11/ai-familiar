import { spawn } from 'node:child_process';
import type { SpeechBackend } from './ttsChannel.js';

export function createSayBackend(): SpeechBackend {
  return {
    speak(text: string): void {
      try {
        const child = spawn('say', [text], {
          detached: true,
          stdio: 'ignore'
        });

        child.on('error', () => {});
        child.unref();
      } catch {
        // The real OS edge is best-effort; sync spawn failures are swallowed.
      }
    }
  };
}
