import { describe, it, expect } from 'vitest';
import {
  voicePreference,
  reconcileTts,
  computeEffectiveConfig
} from '../src/effectiveConfig.js';
import { resolveTtsConfig } from '../src/ttsConfig.js';
import { resolveConfig, parseSettings } from '../src/settings.js';
import type { TtsConfig } from '../src/ttsConfig.js';

describe('effectiveConfig.ts', () => {
  describe('AC1 & AC2: reconcileTts truth table & totality', () => {
    const saySecret: TtsConfig = { provider: 'say' };
    const elSecret: TtsConfig = {
      provider: 'elevenlabs',
      elevenLabs: { apiKey: 'k', voiceId: 'v', modelId: 'm' }
    };

    it('say secret + say pref -> say', () => {
      expect(reconcileTts(saySecret, 'say')).toStrictEqual({ provider: 'say' });
    });

    it('say secret + elevenlabs pref -> say', () => {
      expect(reconcileTts(saySecret, 'elevenlabs')).toStrictEqual({ provider: 'say' });
    });

    it('say secret + null pref -> say', () => {
      expect(reconcileTts(saySecret, null)).toStrictEqual({ provider: 'say' });
    });

    it('elevenlabs secret + say pref -> say', () => {
      expect(reconcileTts(elSecret, 'say')).toStrictEqual({ provider: 'say' });
    });

    it('elevenlabs secret + elevenlabs pref -> elevenlabs (verbatim)', () => {
      const result = reconcileTts(elSecret, 'elevenlabs');
      expect(result).toStrictEqual(elSecret);
    });

    it('elevenlabs secret + null pref -> elevenlabs (verbatim)', () => {
      expect(reconcileTts(elSecret, null)).toStrictEqual(elSecret);
    });

    it('never throws', () => {
      expect(() => reconcileTts(saySecret, 'say')).not.toThrow();
      expect(() => reconcileTts(elSecret, null)).not.toThrow();
    });
  });

  describe('AC3, AC4, AC5: voicePreference', () => {
    it('env wins if valid', () => {
      expect(voicePreference({ FAMILIAR_VOICE: 'say' }, null)).toBe('say');
      expect(voicePreference({ FAMILIAR_VOICE: ' ElevenLabs ' }, null)).toBe('elevenlabs');
      expect(voicePreference({ FAMILIAR_VOICE: 'SAY' }, null)).toBe('say');
    });

    it('env falls through if invalid/empty', () => {
      const file = JSON.stringify({ voice: 'elevenlabs' });
      expect(voicePreference({ FAMILIAR_VOICE: '' }, file)).toBe('elevenlabs');
      expect(voicePreference({ FAMILIAR_VOICE: 'piper' }, file)).toBe('elevenlabs');
      expect(voicePreference({}, file)).toBe('elevenlabs');
    });

    it('file step valid cases', () => {
      expect(voicePreference({}, JSON.stringify({ voice: 'say' }))).toBe('say');
      expect(voicePreference({}, JSON.stringify({ voice: '  ElevenLabs ' }))).toBe('elevenlabs');
    });

    it('file step invalid cases return null', () => {
      expect(voicePreference({}, JSON.stringify({ voice: 'piper' }))).toBeNull();
      expect(voicePreference({}, JSON.stringify({ voice: 123 }))).toBeNull();
      expect(voicePreference({}, JSON.stringify({}))).toBeNull();
      expect(voicePreference({}, 'not json')).toBeNull();
      expect(voicePreference({}, null)).toBeNull();
      expect(voicePreference({}, 'null')).toBeNull();
      expect(voicePreference({}, '[]')).toBeNull();
    });

    it('env overrides file', () => {
      expect(voicePreference({ FAMILIAR_VOICE: 'elevenlabs' }, JSON.stringify({ voice: 'say' }))).toBe('elevenlabs');
    });

    it('totality', () => {
      expect(() => voicePreference({}, 'invalid json')).not.toThrow();
      expect(() => voicePreference({}, null)).not.toThrow();
    });
  });

  describe('AC6, AC7, AC8, AC9: computeEffectiveConfig', () => {
    it('AC6 & AC7: computeEffectiveConfig works (worked example)', () => {
      const raw = '{ "recapLang":"ES", "proactive":true, "voice":"say", "avatar":{"scale":0.5} }';
      const env = { FAMILIAR_RECAP_LANG: 'fr', ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' };
      
      const result = computeEffectiveConfig(env, raw);
      
      const expectedConfig = resolveConfig(env, parseSettings(raw));
      expect(result.config).toStrictEqual(expectedConfig);

      expect(result.tts).toStrictEqual({ provider: 'say' });
    });

    it('AC8: No-regression anchor (raw=null + secret -> elevenlabs)', () => {
      const env = { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' };
      const result = computeEffectiveConfig(env, null);
      
      expect(result.tts).toStrictEqual(resolveTtsConfig(env));
      expect(result.tts.provider).toBe('elevenlabs');
    });

    it('AC9: No-secret anchor (file voice=elevenlabs -> say)', () => {
      const result = computeEffectiveConfig({}, JSON.stringify({ voice: 'elevenlabs' }));
      expect(result.tts).toStrictEqual({ provider: 'say' });
    });
  });
});
