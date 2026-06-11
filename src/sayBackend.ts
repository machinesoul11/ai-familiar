import { spawn } from 'node:child_process';
import type { SpeechBackend } from './ttsChannel.js';

export function createSayBackend(): SpeechBackend {
  return {
    speak(text: string): Promise<void> {
      return new Promise((resolve) => {
        try {
          const child = spawn('say', [text], {
            detached: true,
            stdio: 'ignore'
          });

          child.once('close', () => resolve());
          child.once('error', () => resolve());
          child.unref();
        } catch {
          // The real OS edge is best-effort; sync spawn failures are swallowed.
          resolve();
        }
      });
    }
  };
}
