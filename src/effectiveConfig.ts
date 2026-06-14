import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTINGS_FILENAME,
  parseSettings,
  resolveConfig,
  type ResolvedConfig,
} from './settings.js';
import { resolveTtsConfig, type SpeechProvider, type TtsConfig } from './ttsConfig.js';

export interface EffectiveConfig {
  config: ResolvedConfig;
  tts: TtsConfig;
}

export function voicePreference(
  env: Record<string, string | undefined>,
  raw: string | null,
): SpeechProvider | null {
  const envVoice = parseSpeechProvider(env.FAMILIAR_VOICE);
  if (envVoice) {
    return envVoice;
  }

  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    return parseSpeechProvider(parsed.voice);
  } catch {
    return null;
  }
}

export function reconcileTts(secret: TtsConfig, voicePref: SpeechProvider | null): TtsConfig {
  if (secret.provider === 'elevenlabs' && voicePref !== 'say') {
    return secret;
  }

  return { provider: 'say' };
}

export function computeEffectiveConfig(
  env: Record<string, string | undefined>,
  raw: string | null,
): EffectiveConfig {
  return {
    config: resolveConfig(env, parseSettings(raw)),
    tts: reconcileTts(resolveTtsConfig(env), voicePreference(env, raw)),
  };
}

export function readSettingsText(stateRoot: string): string | null {
  try {
    return readFileSync(join(stateRoot, SETTINGS_FILENAME), 'utf8');
  } catch {
    return null;
  }
}

export function loadEffectiveConfig(
  env: Record<string, string | undefined>,
  stateRoot: string,
): EffectiveConfig {
  return computeEffectiveConfig(env, readSettingsText(stateRoot));
}

function parseSpeechProvider(value: unknown): SpeechProvider | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'say' || normalized === 'elevenlabs' ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
