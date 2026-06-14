import type { RecapLang } from './recapLang.js';
import { TARGET_RECAP_LANGS } from './recapLang.js';
import type { SpeechProvider } from './ttsConfig.js';
import {
  SETTINGS_ENV_KEYS,
  parseSettings,
  resolveConfig,
  type ResolvedConfig,
} from './settings.js';

export type ConfigKey =
  | 'recapLang'
  | 'proactive'
  | 'voice'
  | 'stt'
  | 'stop'
  | 'avatar.scale'
  | 'avatar.monitor'
  | 'avatar.character';

export type ConfigValue = string | number | boolean;
export type ConfigSource = 'default' | 'settings.json' | 'env';
export type SecretName = 'apiKey' | 'voiceId' | 'modelId';

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'recapLang',
  'proactive',
  'voice',
  'stt',
  'stop',
  'avatar.scale',
  'avatar.monitor',
  'avatar.character',
];

export const SECRET_ENV_NAMES: Readonly<Record<SecretName, string>> = Object.freeze({
  apiKey: 'ELEVENLABS_API_KEY',
  voiceId: 'ELEVENLABS_VOICE_ID',
  modelId: 'ELEVENLABS_MODEL_ID',
});

export type ValidateResult =
  | { ok: true; value: ConfigValue }
  | { ok: false; error: string };

export type SecretResult =
  | { ok: true; envName: string; value: string }
  | { ok: false; error: string };

export interface KeyView {
  key: ConfigKey;
  value: ConfigValue;
  source: ConfigSource;
}

export interface WizardStep {
  key: ConfigKey;
  prompt: string;
  choices?: readonly string[];
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  { key: 'voice', prompt: 'Choose a voice provider', choices: ['say', 'elevenlabs'] },
  { key: 'recapLang', prompt: 'Choose a recap language', choices: ['en', 'es', 'fr', 'de', 'ja'] },
  { key: 'proactive', prompt: 'Enable proactive narration', choices: ['true', 'false'] },
];

const RECAP_LANGS: readonly RecapLang[] = ['en', ...TARGET_RECAP_LANGS];
const SPEECH_PROVIDERS: readonly SpeechProvider[] = ['say', 'elevenlabs'];
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function validateSetting(key: string, rawValue: string): ValidateResult {
  if (!isConfigKey(key)) {
    return { ok: false, error: `Unknown key '${key}'. Valid keys: ${CONFIG_KEYS.join(', ')}` };
  }

  const trimmed = rawValue.trim();
  const normalized = trimmed.toLowerCase();

  switch (key) {
    case 'recapLang':
      return isRecapLang(normalized)
        ? { ok: true, value: normalized }
        : { ok: false, error: `Invalid recapLang. Valid values: ${RECAP_LANGS.join(', ')}` };
    case 'voice':
      return isSpeechProvider(normalized)
        ? { ok: true, value: normalized }
        : { ok: false, error: `Invalid voice. Valid values: ${SPEECH_PROVIDERS.join(', ')}` };
    case 'proactive':
    case 'stt':
    case 'stop':
      return parseBooleanToken(normalized);
    case 'avatar.scale':
      return parsePositiveNumber(trimmed);
    case 'avatar.monitor':
      return parsePositiveInteger(trimmed);
    case 'avatar.character':
      return { ok: true, value: trimmed };
  }
}

export function validateSecret(name: string, value: string): SecretResult {
  if (!isSecretName(name)) {
    return { ok: false, error: 'Unknown secret name. Valid names: apiKey, voiceId, modelId' };
  }

  if (value.includes('\n') || value.includes('\r')) {
    return { ok: false, error: `${name} must not contain newlines` };
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: false, error: `${name} must not be empty` };
  }

  return { ok: true, envName: SECRET_ENV_NAMES[name], value: trimmed };
}

export function applySetting(rawText: string | null, key: ConfigKey, value: ConfigValue): string {
  const obj = parseObject(rawText);

  if (isAvatarKey(key)) {
    if (!isRecord(obj.avatar)) {
      obj.avatar = {};
    }
    const avatar = obj.avatar;
    if (isRecord(avatar)) {
      avatar[avatarLeaf(key)] = value;
    }
  } else {
    obj[key] = value;
  }

  return serializeObject(obj);
}

export function removeSetting(rawText: string | null, key: ConfigKey): string {
  const obj = parseObject(rawText);

  if (isAvatarKey(key)) {
    if (isRecord(obj.avatar)) {
      delete obj.avatar[avatarLeaf(key)];
      if (Object.keys(obj.avatar).length === 0) {
        delete obj.avatar;
      }
    }
  } else {
    delete obj[key];
  }

  return serializeObject(obj);
}

export function upsertEnv(existingText: string | null, updates: Record<string, string>): string {
  const lines = splitBodyLines(existingText);

  for (const [key, value] of Object.entries(updates)) {
    const matcher = new RegExp(`^\\s*${escapeRegExp(key)}=`);
    const index = lines.findIndex((line) => matcher.test(line));
    const nextLine = `${key}=${value}`;

    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function describeConfig(env: Record<string, string | undefined>, rawText: string | null): KeyView[] {
  const resolved = resolveConfig(env, parseSettings(rawText));
  const rawObject = parseValidObject(rawText);

  return CONFIG_KEYS.map((key) => ({
    key,
    value: readConfigValue(resolved, key),
    source: sourceForKey(env, rawObject, key),
  }));
}

export function getConfigValue(
  env: Record<string, string | undefined>,
  rawText: string | null,
  key: string,
): ConfigValue | null {
  if (!isConfigKey(key)) {
    return null;
  }

  return readConfigValue(resolveConfig(env, parseSettings(rawText)), key);
}

export function applyWizardAnswers(
  rawText: string | null,
  answers: Partial<Record<ConfigKey, string>>,
): { ok: true; text: string } | { ok: false; errors: { key: ConfigKey; error: string }[] } {
  const valid: { key: ConfigKey; value: ConfigValue }[] = [];
  const errors: { key: ConfigKey; error: string }[] = [];

  for (const step of WIZARD_STEPS) {
    const raw = answers[step.key];
    if (typeof raw !== 'string' || raw.trim() === '') {
      continue;
    }

    const result = validateSetting(step.key, raw);
    if (result.ok) {
      valid.push({ key: step.key, value: result.value });
    } else {
      errors.push({ key: step.key, error: result.error });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  let text = serializeObject(parseObject(rawText));
  for (const { key, value } of valid) {
    text = applySetting(text, key, value);
  }

  return { ok: true, text };
}

function parseBooleanToken(normalized: string): ValidateResult {
  if (TRUE_VALUES.has(normalized)) {
    return { ok: true, value: true };
  }
  if (FALSE_VALUES.has(normalized)) {
    return { ok: true, value: false };
  }

  return {
    ok: false,
    error: 'Invalid boolean. Valid values: true, false, 1, 0, yes, no, on, off',
  };
}

function parsePositiveNumber(trimmed: string): ValidateResult {
  const value = Number(trimmed);
  return trimmed !== '' && Number.isFinite(value) && value > 0
    ? { ok: true, value }
    : { ok: false, error: 'avatar.scale must be a positive number' };
}

function parsePositiveInteger(trimmed: string): ValidateResult {
  const value = Number(trimmed);
  return trimmed !== '' && Number.isInteger(value) && value >= 1
    ? { ok: true, value }
    : { ok: false, error: 'avatar.monitor must be a positive integer' };
}

function sourceForKey(
  env: Record<string, string | undefined>,
  rawObject: Record<string, unknown> | null,
  key: ConfigKey,
): ConfigSource {
  if (envValueIsValid(env, key)) {
    return 'env';
  }

  if (rawObject !== null && fileValueIsValid(rawObject, key)) {
    return 'settings.json';
  }

  return 'default';
}

function envValueIsValid(env: Record<string, string | undefined>, key: ConfigKey): boolean {
  switch (key) {
    case 'recapLang':
      return parseEnvRecapLang(env[SETTINGS_ENV_KEYS.recapLang]) !== null;
    case 'proactive':
      return parseEnvBoolean(env[SETTINGS_ENV_KEYS.proactive]) !== null;
    case 'voice':
      return parseEnvSpeechProvider(env[SETTINGS_ENV_KEYS.voice]) !== null;
    case 'stt':
      return parseEnvBoolean(env[SETTINGS_ENV_KEYS.stt]) !== null;
    case 'stop':
      return parseEnvBoolean(env[SETTINGS_ENV_KEYS.stop]) !== null;
    case 'avatar.scale':
      return parseEnvPositiveNumber(env[SETTINGS_ENV_KEYS.avatarScale]) !== null;
    case 'avatar.monitor':
      return parseEnvPositiveInteger(env[SETTINGS_ENV_KEYS.avatarMonitor]) !== null;
    case 'avatar.character':
      return parseEnvCharacter(env[SETTINGS_ENV_KEYS.avatarCharacter]) !== null;
  }
}

function fileValueIsValid(obj: Record<string, unknown>, key: ConfigKey): boolean {
  switch (key) {
    case 'recapLang':
      return coerceRecapLang(obj.recapLang) !== null;
    case 'proactive':
      return typeof obj.proactive === 'boolean';
    case 'voice':
      return coerceSpeechProvider(obj.voice) !== null;
    case 'stt':
      return typeof obj.stt === 'boolean';
    case 'stop':
      return typeof obj.stop === 'boolean';
    case 'avatar.scale':
      return isRecord(obj.avatar) && coercePositiveNumber(obj.avatar.scale) !== null;
    case 'avatar.monitor':
      return isRecord(obj.avatar) && coercePositiveInteger(obj.avatar.monitor) !== null;
    case 'avatar.character':
      return isRecord(obj.avatar) && typeof obj.avatar.character === 'string';
  }
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
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
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

function coercePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function coercePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function readConfigValue(config: ResolvedConfig, key: ConfigKey): ConfigValue {
  switch (key) {
    case 'recapLang':
      return config.recapLang;
    case 'proactive':
      return config.proactive;
    case 'voice':
      return config.voice;
    case 'stt':
      return config.stt;
    case 'stop':
      return config.stop;
    case 'avatar.scale':
      return config.avatar.scale;
    case 'avatar.monitor':
      return config.avatar.monitor;
    case 'avatar.character':
      return config.avatar.character;
  }
}

function parseObject(rawText: string | null): Record<string, unknown> {
  const parsed = parseValidObject(rawText);
  return parsed ?? {};
}

function parseValidObject(rawText: string | null): Record<string, unknown> | null {
  if (rawText === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawText);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeObject(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function splitBodyLines(text: string | null): string[] {
  const lines = (text ?? '').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function avatarLeaf(key: ConfigKey): 'scale' | 'monitor' | 'character' {
  return key.slice('avatar.'.length) as 'scale' | 'monitor' | 'character';
}

function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

function isSecretName(name: string): name is SecretName {
  return Object.hasOwn(SECRET_ENV_NAMES, name);
}

function isAvatarKey(key: ConfigKey): key is 'avatar.scale' | 'avatar.monitor' | 'avatar.character' {
  return key.startsWith('avatar.');
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
