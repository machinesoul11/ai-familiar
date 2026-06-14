import type { SpeechBackend } from './ttsChannel.js';
import type { SpeechProvider } from './ttsConfig.js';

export interface RoutingBackendDeps {
  resolveProvider(): SpeechProvider;
  backends: {
    say(): SpeechBackend;
    elevenlabs(): SpeechBackend;
  };
}

export function createRoutingBackend(deps: RoutingBackendDeps): SpeechBackend {
  const cached: Partial<Record<SpeechProvider, SpeechBackend>> = {};

  return {
    speak(text: string): void | Promise<void> {
      try {
        const provider = deps.resolveProvider();
        const backend = cached[provider] ?? (cached[provider] = deps.backends[provider]());
        return backend.speak(text);
      } catch {
        return undefined;
      }
    },
    stop(): void {
      try {
        for (const backend of Object.values(cached)) {
          try {
            backend?.stop?.();
          } catch {
            // Stop is best-effort across all cached providers.
          }
        }
      } catch {
        // stop must never throw to callers.
      }
    },
  };
}
