export type SpeechProvider = 'say' | 'elevenlabs';

export interface ElevenLabsSettings {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface TtsConfig {
  provider: SpeechProvider;
  elevenLabs?: ElevenLabsSettings;
}

export const DEFAULT_ELEVENLABS_MODEL = 'eleven_turbo_v2_5';

export function resolveTtsConfig(env: Record<string, string | undefined>): TtsConfig {
  const key = env.ELEVENLABS_API_KEY;
  const voice = env.ELEVENLABS_VOICE_ID;
  const model = env.ELEVENLABS_MODEL_ID;

  if (typeof key === 'string' && key.trim() !== '' && typeof voice === 'string' && voice.trim() !== '') {
    return {
      provider: 'elevenlabs',
      elevenLabs: {
        apiKey: key,
        voiceId: voice,
        modelId: typeof model === 'string' && model.trim() !== '' ? model : DEFAULT_ELEVENLABS_MODEL,
      },
    };
  }

  return { provider: 'say' };
}
