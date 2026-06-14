import type { RecapLang } from './recapLang.js';
import type { SpeechProvider } from './ttsConfig.js';

export interface AvatarSettings {
  scale: number;
  monitor: number;
  character: string;
}

export interface Settings {
  recapLang: RecapLang;
  proactive: boolean;
  voice: SpeechProvider;
  stt: boolean;
  stop: boolean;
  avatar: AvatarSettings;
}

export type ResolvedConfig = Settings;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  recapLang: 'en',
  proactive: false,
  voice: 'say',
  stt: true,
  stop: true,
  avatar: Object.freeze({
    scale: 1.0,
    monitor: 2,
    character: '',
  }),
});

export const SETTINGS_FILENAME = 'settings.json';

export const SETTINGS_ENV_KEYS = {
  recapLang: 'FAMILIAR_RECAP_LANG',
  proactive: 'FAMILIAR_PROACTIVE',
  voice: 'FAMILIAR_VOICE',
  stt: 'FAMILIAR_STT',
  stop: 'FAMILIAR_STOP',
  avatarScale: 'FAMILIAR_AVATAR_SCALE',
  avatarMonitor: 'FAMILIAR_AVATAR_MONITOR',
  avatarCharacter: 'FAMILIAR_AVATAR_CHARACTER',
} as const;

const RECAP_LANGS: readonly RecapLang[] = ['en', 'es', 'fr', 'de', 'ja'];
const SPEECH_PROVIDERS: readonly SpeechProvider[] = ['say', 'elevenlabs'];
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

export function parseSettings(raw: string | null): Settings {
  if (raw === null) {
    return DEFAULT_SETTINGS;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  if (!isRecord(parsed)) {
    return DEFAULT_SETTINGS;
  }

  return {
    recapLang: coerceRecapLang(parsed.recapLang) ?? DEFAULT_SETTINGS.recapLang,
    proactive: coerceBoolean(parsed.proactive) ?? DEFAULT_SETTINGS.proactive,
    voice: coerceSpeechProvider(parsed.voice) ?? DEFAULT_SETTINGS.voice,
    stt: coerceBoolean(parsed.stt) ?? DEFAULT_SETTINGS.stt,
    stop: coerceBoolean(parsed.stop) ?? DEFAULT_SETTINGS.stop,
    avatar: coerceAvatarSettings(parsed.avatar),
  };
}

export function resolveConfig(env: Record<string, string | undefined>, settings: Settings): ResolvedConfig {
  return {
    recapLang: parseEnvRecapLang(env[SETTINGS_ENV_KEYS.recapLang]) ?? settings.recapLang,
    proactive: parseEnvBoolean(env[SETTINGS_ENV_KEYS.proactive]) ?? settings.proactive,
    voice: parseEnvSpeechProvider(env[SETTINGS_ENV_KEYS.voice]) ?? settings.voice,
    stt: parseEnvBoolean(env[SETTINGS_ENV_KEYS.stt]) ?? settings.stt,
    stop: parseEnvBoolean(env[SETTINGS_ENV_KEYS.stop]) ?? settings.stop,
    avatar: {
      scale: parseEnvPositiveNumber(env[SETTINGS_ENV_KEYS.avatarScale]) ?? settings.avatar.scale,
      monitor: parseEnvPositiveInteger(env[SETTINGS_ENV_KEYS.avatarMonitor]) ?? settings.avatar.monitor,
      character: parseEnvCharacter(env[SETTINGS_ENV_KEYS.avatarCharacter]) ?? settings.avatar.character,
    },
  };
}

function coerceAvatarSettings(value: unknown): AvatarSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS.avatar;
  }

  return {
    scale: coercePositiveNumber(value.scale) ?? DEFAULT_SETTINGS.avatar.scale,
    monitor: coercePositiveInteger(value.monitor) ?? DEFAULT_SETTINGS.avatar.monitor,
    character: typeof value.character === 'string' ? value.character : DEFAULT_SETTINGS.avatar.character,
  };
}

function coerceRecapLang(value: unknown): RecapLang | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isRecapLang(normalized) ? normalized : null;
}

function coerceSpeechProvider(value: unknown): SpeechProvider | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isSpeechProvider(normalized) ? normalized : null;
}

function coerceBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function coercePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function coercePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function parseEnvRecapLang(raw: string | undefined): RecapLang | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized !== '' && isRecapLang(normalized) ? normalized : null;
}

function parseEnvSpeechProvider(raw: string | undefined): SpeechProvider | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized !== '' && isSpeechProvider(normalized) ? normalized : null;
}

function parseEnvBoolean(raw: string | undefined): boolean | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }

  return null;
}

function parseEnvPositiveNumber(raw: string | undefined): number | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseEnvPositiveInteger(raw: string | undefined): number | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function parseEnvCharacter(raw: string | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecapLang(value: string): value is RecapLang {
  return (RECAP_LANGS as readonly string[]).includes(value);
}

function isSpeechProvider(value: string): value is SpeechProvider {
  return (SPEECH_PROVIDERS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
