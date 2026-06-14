import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILENAME,
  SETTINGS_ENV_KEYS,
  parseSettings,
  resolveConfig
} from '../src/settings.js';

describe('Settings core (Contract 6.1)', () => {
  describe('Constants and Defaults', () => {
    it('criterion 1: DEFAULT_SETTINGS matches the contract', () => {
      expect(DEFAULT_SETTINGS).toStrictEqual({
        recapLang: 'en',
        proactive: false,
        voice: 'say',
        stt: true,
        stop: true,
        avatar: { scale: 1.0, monitor: 2, character: '' },
      });
    });

    it('criterion 2: SETTINGS_FILENAME is settings.json', () => {
      expect(SETTINGS_FILENAME).toBe('settings.json');
    });

    it('criterion 2: SETTINGS_ENV_KEYS match the contract', () => {
      expect(SETTINGS_ENV_KEYS).toStrictEqual({
        recapLang: 'FAMILIAR_RECAP_LANG',
        proactive: 'FAMILIAR_PROACTIVE',
        voice: 'FAMILIAR_VOICE',
        stt: 'FAMILIAR_STT',
        stop: 'FAMILIAR_STOP',
        avatarScale: 'FAMILIAR_AVATAR_SCALE',
        avatarMonitor: 'FAMILIAR_AVATAR_MONITOR',
        avatarCharacter: 'FAMILIAR_AVATAR_CHARACTER',
      });
    });
  });

  describe('parseSettings(raw)', () => {
    it('criterion 1: returns DEFAULT_SETTINGS when input is null', () => {
      expect(parseSettings(null)).toStrictEqual(DEFAULT_SETTINGS);
    });

    it('criterion 3: returns DEFAULT_SETTINGS for malformed JSON or non-object top levels', () => {
      expect(parseSettings('{ not json')).toStrictEqual(DEFAULT_SETTINGS);
      expect(parseSettings('42')).toStrictEqual(DEFAULT_SETTINGS);
      expect(parseSettings('"x"')).toStrictEqual(DEFAULT_SETTINGS);
      expect(parseSettings('true')).toStrictEqual(DEFAULT_SETTINGS);
      expect(parseSettings('null')).toStrictEqual(DEFAULT_SETTINGS);
      expect(parseSettings('[1,2]')).toStrictEqual(DEFAULT_SETTINGS);
    });

    it('criterion 4: parses a full valid settings object', () => {
      const raw = JSON.stringify({
        recapLang: 'fr',
        proactive: true,
        voice: 'elevenlabs',
        stt: false,
        stop: false,
        avatar: { scale: 0.8, monitor: 1, character: 'valerie' }
      });
      expect(parseSettings(raw)).toStrictEqual({
        recapLang: 'fr',
        proactive: true,
        voice: 'elevenlabs',
        stt: false,
        stop: false,
        avatar: { scale: 0.8, monitor: 1, character: 'valerie' }
      });
    });

    it('criterion 5, 10: per-field default fallback and completeness', () => {
      const raw = JSON.stringify({ proactive: 'yes' }); // wrong type for proactive
      const result = parseSettings(raw);
      expect(result.proactive).toBe(false); // default
      expect(result.recapLang).toBe('en'); // default
      expect(result.avatar).toStrictEqual(DEFAULT_SETTINGS.avatar);
      // Ensure all fields are present
      expect(Object.keys(result).sort()).toStrictEqual(['avatar', 'proactive', 'recapLang', 'stop', 'stt', 'voice']);
      expect(Object.keys(result.avatar).sort()).toStrictEqual(['character', 'monitor', 'scale']);
    });

    it('criterion 6: enum fields (recapLang, voice) trim, lowercase, and validate', () => {
      expect(parseSettings(JSON.stringify({ recapLang: '  ES  ' })).recapLang).toBe('es');
      expect(parseSettings(JSON.stringify({ recapLang: 'FR' })).recapLang).toBe('fr');
      expect(parseSettings(JSON.stringify({ recapLang: 'xx' })).recapLang).toBe('en');

      expect(parseSettings(JSON.stringify({ voice: '  ElevenLabs  ' })).voice).toBe('elevenlabs');
      expect(parseSettings(JSON.stringify({ voice: 'SAY' })).voice).toBe('say');
      expect(parseSettings(JSON.stringify({ voice: 'piper' })).voice).toBe('say');
    });

    it('criterion 7: boolean fields (proactive, stt, stop) must be JSON booleans', () => {
      expect(parseSettings(JSON.stringify({ proactive: true })).proactive).toBe(true);
      expect(parseSettings(JSON.stringify({ proactive: "true" })).proactive).toBe(false); // string -> default
      expect(parseSettings(JSON.stringify({ stt: false })).stt).toBe(false);
      expect(parseSettings(JSON.stringify({ stt: 0 })).stt).toBe(true); // number -> default (true)
      expect(parseSettings(JSON.stringify({ stop: false })).stop).toBe(false);
    });

    it('criterion 8: avatar sub-fields coercion', () => {
      // Valid avatar
      expect(parseSettings(JSON.stringify({ avatar: { scale: 1.5, monitor: 3, character: 'haru' } })).avatar)
        .toStrictEqual({ scale: 1.5, monitor: 3, character: 'haru' });

      // Partial / Invalid avatar fields
      const result = parseSettings(JSON.stringify({
        avatar: { scale: -1, monitor: 0, character: 123 }
      }));
      expect(result.avatar).toStrictEqual({ scale: 1.0, monitor: 2, character: '' });

      // Non-integer monitor or non-finite scale
      expect(parseSettings(JSON.stringify({ avatar: { monitor: 1.5 } })).avatar.monitor).toBe(2);
      expect(parseSettings(JSON.stringify({ avatar: { scale: Infinity } })).avatar.scale).toBe(1.0);
      expect(parseSettings(JSON.stringify({ avatar: { scale: "0.5" } })).avatar.scale).toBe(1.0);

      // Verbatim character string
      expect(parseSettings(JSON.stringify({ avatar: { character: '  spacey  ' } })).avatar.character).toBe('  spacey  ');
      
      // Non-object avatar
      expect(parseSettings(JSON.stringify({ avatar: "not an object" })).avatar).toStrictEqual(DEFAULT_SETTINGS.avatar);
    });

    it('criterion 9: ignores unknown keys', () => {
      const raw = JSON.stringify({
        recapLang: 'en',
        unknownTop: 'key',
        avatar: { scale: 1.0, unknownInner: 42 }
      });
      const result = parseSettings(raw) as any;
      expect(result.unknownTop).toBeUndefined();
      expect(result.avatar.unknownInner).toBeUndefined();
      expect(result.recapLang).toBe('en');
    });
  });

  describe('resolveConfig(env, settings)', () => {
    it('criterion 11: valid env overrides win', () => {
      const settings = DEFAULT_SETTINGS;
      const env = {
        FAMILIAR_RECAP_LANG: 'ja',
        FAMILIAR_PROACTIVE: 'true',
        FAMILIAR_VOICE: 'elevenlabs',
        FAMILIAR_STT: 'off',
        FAMILIAR_STOP: '0',
        FAMILIAR_AVATAR_SCALE: '2.5',
        FAMILIAR_AVATAR_MONITOR: '4',
        FAMILIAR_AVATAR_CHARACTER: 'valerie'
      };
      const resolved = resolveConfig(env, settings);
      expect(resolved).toStrictEqual({
        recapLang: 'ja',
        proactive: true,
        voice: 'elevenlabs',
        stt: false,
        stop: false,
        avatar: { scale: 2.5, monitor: 4, character: 'valerie' }
      });
    });

    it('criterion 12: falls through when env is absent/invalid/empty', () => {
      const settings: any = {
        recapLang: 'es',
        proactive: true,
        voice: 'elevenlabs',
        stt: false,
        stop: false,
        avatar: { scale: 0.5, monitor: 3, character: 'haru' }
      };
      const env = {
        FAMILIAR_RECAP_LANG: 'xx', // invalid
        FAMILIAR_PROACTIVE: 'maybe', // invalid
        FAMILIAR_AVATAR_SCALE: 'big', // invalid
        FAMILIAR_AVATAR_MONITOR: '0', // invalid (< 1)
        FAMILIAR_AVATAR_CHARACTER: '  ' // empty (after trim)
      };
      const resolved = resolveConfig(env, settings);
      expect(resolved).toStrictEqual(settings);
    });

    it('criterion 13: boolean env tri-state', () => {
      const settingsTrue = { ...DEFAULT_SETTINGS, proactive: true, stt: true, stop: true };
      const settingsFalse = { ...DEFAULT_SETTINGS, proactive: false, stt: false, stop: false };

      // Force false when settings is true
      expect(resolveConfig({ FAMILIAR_PROACTIVE: '0' }, settingsTrue).proactive).toBe(false);
      expect(resolveConfig({ FAMILIAR_STT: 'false' }, settingsTrue).stt).toBe(false);
      expect(resolveConfig({ FAMILIAR_STOP: 'no' }, settingsTrue).stop).toBe(false);
      expect(resolveConfig({ FAMILIAR_STOP: 'off' }, settingsTrue).stop).toBe(false);

      // Force true when settings is false
      expect(resolveConfig({ FAMILIAR_PROACTIVE: '1' }, settingsFalse).proactive).toBe(true);
      expect(resolveConfig({ FAMILIAR_STT: 'true' }, settingsFalse).stt).toBe(true);
      expect(resolveConfig({ FAMILIAR_STOP: 'yes' }, settingsFalse).stop).toBe(true);
      expect(resolveConfig({ FAMILIAR_STOP: 'on' }, settingsFalse).stop).toBe(true);

      // Unrecognized falls through
      expect(resolveConfig({ FAMILIAR_PROACTIVE: 'banana' }, settingsTrue).proactive).toBe(true);
      expect(resolveConfig({ FAMILIAR_PROACTIVE: 'banana' }, settingsFalse).proactive).toBe(false);
    });

    it('criterion 14: independence of fields and avatar sub-fields', () => {
      const settings = DEFAULT_SETTINGS;
      const env = { FAMILIAR_AVATAR_SCALE: '2.0' };
      const resolved = resolveConfig(env, settings);
      expect(resolved.avatar.scale).toBe(2.0);
      expect(resolved.avatar.monitor).toBe(settings.avatar.monitor);
      expect(resolved.avatar.character).toBe(settings.avatar.character);
      expect(resolved.recapLang).toBe(settings.recapLang);
    });

    it('criterion 15: totality - resolveConfig({}, DEFAULT_SETTINGS) equals DEFAULT_SETTINGS', () => {
      expect(resolveConfig({}, DEFAULT_SETTINGS)).toStrictEqual(DEFAULT_SETTINGS);
    });
  });

  describe('criterion 16: Worked Example', () => {
    it('reproduces the worked example exactly', () => {
      const rawText = JSON.stringify({
        "recapLang": "ES",
        "proactive": true,
        "voice": "elevenlabs",
        "stt": false,
        "avatar": { "scale": 0.5, "monitor": "two", "character": "haru", "x": 9 },
        "unknownKey": 123
      });

      const env = {
        FAMILIAR_RECAP_LANG: 'fr',
        FAMILIAR_PROACTIVE: '0',
        FAMILIAR_AVATAR_SCALE: 'big'
      };

      const parsed = parseSettings(rawText);
      expect(parsed).toStrictEqual({
        recapLang: 'es',
        proactive: true,
        voice: 'elevenlabs',
        stt: false,
        stop: true, // absent -> default
        avatar: {
          scale: 0.5,
          monitor: 2, // "two" -> default
          character: 'haru'
        }
      });

      const resolved = resolveConfig(env, parsed);
      expect(resolved).toStrictEqual({
        recapLang: 'fr', // env override
        proactive: false, // env '0' override
        voice: 'elevenlabs', // no env -> file
        stt: false, // no env -> file
        stop: true, // no env -> default (from file)
        avatar: {
          scale: 0.5, // env 'big' -> invalid -> file
          monitor: 2, // no env -> file
          character: 'haru' // no env -> file
        }
      });
    });
  });
});
