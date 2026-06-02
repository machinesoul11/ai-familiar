import type { ElevenLabsSettings } from './ttsConfig.js';

export interface ElevenLabsRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function buildTtsRequest(input: { text: string; settings: ElevenLabsSettings }): ElevenLabsRequest {
  return {
    url: 'https://api.elevenlabs.io/v1/text-to-speech/' + input.settings.voiceId,
    headers: {
      'xi-api-key': input.settings.apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text: input.text, model_id: input.settings.modelId }),
  };
}
