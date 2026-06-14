import type { SpeechBackend } from './ttsChannel.js';

export function createSerializedBackend(
  inner: SpeechBackend,
): SpeechBackend & { stop(): void; isSpeaking(): boolean } {
  const queue: string[] = [];
  let pumping = false;

  async function pump(): Promise<void> {
    while (queue.length > 0) {
      const text = queue.shift()!;

      try {
        const result = inner.speak(text);
        await Promise.resolve(result);
      } catch {
        // Keep the queue moving even when the inner backend fails.
      }
    }

    pumping = false;

    if (queue.length > 0) {
      pumping = true;
      void pump();
    }
  }

  return {
    speak(text: string): void {
      try {
        queue.push(text);

        if (!pumping) {
          pumping = true;
          void pump();
        }
      } catch {
        // The serializer must never throw to callers.
      }
    },
    stop(): void {
      try {
        queue.length = 0;
        inner.stop?.();
      } catch {
        // stop must never throw to callers.
      }
    },
    isSpeaking(): boolean {
      return pumping;
    },
  };
}
