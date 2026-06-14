import { describe, it, expect } from 'vitest';
import {
  CONFIG_KEYS,
  SECRET_ENV_NAMES,
  WIZARD_STEPS,
  validateSetting,
  validateSecret,
  applySetting,
  removeSetting,
  upsertEnv,
  describeConfig,
  getConfigValue,
  applyWizardAnswers
} from '../src/configWrite.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

describe('configWrite', () => {
  describe('CONFIG_KEYS', () => {
    it('contains the 8 keys in display order', () => {
      expect(CONFIG_KEYS).toStrictEqual([
        'recapLang',
        'proactive',
        'voice',
        'stt',
        'stop',
        'avatar.scale',
        'avatar.monitor',
        'avatar.character'
      ]);
    });
  });

  describe('SECRET_ENV_NAMES', () => {
    it('maps secret names to env variables', () => {
      expect(SECRET_ENV_NAMES).toStrictEqual({
        apiKey: 'ELEVENLABS_API_KEY',
        voiceId: 'ELEVENLABS_VOICE_ID',
        modelId: 'ELEVENLABS_MODEL_ID'
      });
    });
  });

  describe('validateSetting', () => {
    it('validates recapLang case-insensitively with whitespace (AC 1)', () => {
      expect(validateSetting('recapLang', ' ES ')).toStrictEqual({ ok: true, value: 'es' });
      expect(validateSetting('recapLang', 'fr')).toStrictEqual({ ok: true, value: 'fr' });
      expect(validateSetting('recapLang', 'klingon').ok).toBe(false);
    });

    it('validates voice case-insensitively (AC 1)', () => {
      expect(validateSetting('voice', ' ElevenLabs ')).toStrictEqual({ ok: true, value: 'elevenlabs' });
      expect(validateSetting('voice', 'say')).toStrictEqual({ ok: true, value: 'say' });
    });

    it('validates booleans (proactive, stt, stop) (AC 1)', () => {
      expect(validateSetting('proactive', 'yes')).toStrictEqual({ ok: true, value: true });
      expect(validateSetting('stt', '0')).toStrictEqual({ ok: true, value: false });
      expect(validateSetting('stop', 'on')).toStrictEqual({ ok: true, value: true });
      expect(validateSetting('proactive', 'off')).toStrictEqual({ ok: true, value: false });
      expect(validateSetting('proactive', 'maybe').ok).toBe(false);
    });

    it('validates avatar.scale (positive number) (AC 2)', () => {
      expect(validateSetting('avatar.scale', ' 1.5 ')).toStrictEqual({ ok: true, value: 1.5 });
      expect(validateSetting('avatar.scale', '0').ok).toBe(false);
      expect(validateSetting('avatar.scale', '-1').ok).toBe(false);
      expect(validateSetting('avatar.scale', 'abc').ok).toBe(false);
    });

    it('validates avatar.monitor (positive integer) (AC 2)', () => {
      expect(validateSetting('avatar.monitor', ' 2 ')).toStrictEqual({ ok: true, value: 2 });
      expect(validateSetting('avatar.monitor', '1.5').ok).toBe(false);
      expect(validateSetting('avatar.monitor', '0').ok).toBe(false);
    });

    it('validates avatar.character (trimmed string, always ok) (AC 3)', () => {
      expect(validateSetting('avatar.character', ' Haru ')).toStrictEqual({ ok: true, value: 'Haru' });
      expect(validateSetting('avatar.character', '  ')).toStrictEqual({ ok: true, value: '' });
      expect(validateSetting('avatar.character', '')).toStrictEqual({ ok: true, value: '' });
    });

    it('returns error containing valid tokens for unknown key or invalid value (AC 4)', () => {
      const unknown = validateSetting('nope', 'val');
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) {
        CONFIG_KEYS.forEach(key => expect(unknown.error).toContain(key));
      }

      const invalidLang = validateSetting('recapLang', 'klingon');
      expect(invalidLang.ok).toBe(false);
      if (!invalidLang.ok) {
        ['en', 'es', 'fr', 'de', 'ja'].forEach(token => expect(invalidLang.error).toContain(token));
      }
    });
  });

  describe('validateSecret', () => {
    it('validates valid secrets and trims whitespace (AC 5)', () => {
      expect(validateSecret('apiKey', ' sk-x ')).toStrictEqual({
        ok: true,
        envName: 'ELEVENLABS_API_KEY',
        value: 'sk-x'
      });
      expect(validateSecret('voiceId', 'v1')).toStrictEqual({
        ok: true,
        envName: 'ELEVENLABS_VOICE_ID',
        value: 'v1'
      });
      expect(validateSecret('modelId', 'm1')).toStrictEqual({
        ok: true,
        envName: 'ELEVENLABS_MODEL_ID',
        value: 'm1'
      });
    });

    it('rejects unknown name, empty value, or newlines (AC 6)', () => {
      expect(validateSecret('unknown', 'val').ok).toBe(false);
      expect(validateSecret('apiKey', '  ').ok).toBe(false);
      expect(validateSecret('apiKey', 'val\n').ok).toBe(false);
      expect(validateSecret('apiKey', 'val\r').ok).toBe(false);
    });
  });

  describe('applySetting', () => {
    it('performs sparse merge and handles nesting (AC 7)', () => {
      const t1 = applySetting(null, 'voice', 'elevenlabs');
      expect(JSON.parse(t1)).toStrictEqual({ voice: 'elevenlabs' });

      const t2 = applySetting(t1, 'avatar.scale', 1.5);
      expect(JSON.parse(t2)).toStrictEqual({ voice: 'elevenlabs', avatar: { scale: 1.5 } });
    });

    it('preserves sibling keys in nested objects (AC 8)', () => {
      const base = JSON.stringify({ avatar: { scale: 1.5, character: 'Haru' } });
      const result = applySetting(base, 'avatar.monitor', 1);
      expect(JSON.parse(result).avatar).toStrictEqual({ scale: 1.5, character: 'Haru', monitor: 1 });
    });

    it('is robust against malformed or non-object base and preserves unknown keys (AC 9)', () => {
      expect(JSON.parse(applySetting('not-json', 'stt', true))).toStrictEqual({ stt: true });
      expect(JSON.parse(applySetting('[]', 'stt', true))).toStrictEqual({ stt: true });
      
      const result = applySetting('{\n  "extra": 42\n}', 'stop', false);
      expect(JSON.parse(result)).toStrictEqual({ extra: 42, stop: false });
      expect(result).toMatch(/{\n  "extra": 42,\n  "stop": false\n}\n/);
    });
  });

  describe('removeSetting', () => {
    it('removes top-level and nested keys, cleaning up empty parents (AC 10)', () => {
      const base = JSON.stringify({ voice: 'say', avatar: { scale: 1.5 } });
      
      const r1 = removeSetting(base, 'voice');
      expect(JSON.parse(r1)).toStrictEqual({ avatar: { scale: 1.5 } });

      const r2 = removeSetting(r1, 'avatar.scale');
      expect(JSON.parse(r2)).toStrictEqual({});
      expect(r2).toBe('{}\n');

      expect(removeSetting(base, 'absent')).toStrictEqual(JSON.stringify(JSON.parse(base), null, 2) + '\n');
    });
  });

  describe('upsertEnv', () => {
    it('appends when absent and replaces in place (AC 11)', () => {
      const e1 = upsertEnv(null, { KEY1: 'val1' });
      expect(e1).toBe('KEY1=val1\n');

      const base = '# comment\nKEY1=old\nKEY2=keep';
      const e2 = upsertEnv(base, { KEY1: 'new', KEY3: 'add' });
      expect(e2).toBe('# comment\nKEY1=new\nKEY2=keep\nKEY3=add\n');
    });

    it('is idempotent and handles leading whitespace (AC 12)', () => {
      const base = '  KEY=old\n';
      const e1 = upsertEnv(base, { KEY: 'new' });
      expect(e1).toBe('KEY=new\n');
      
      const e2 = upsertEnv(e1, { KEY: 'new' });
      expect(e2).toBe(e1);
    });
  });

  describe('describeConfig and getConfigValue', () => {
    it('returns defaults for empty state (AC 13)', () => {
      const views = describeConfig({}, null);
      expect(views).toHaveLength(8);
      expect(views.map(v => v.key)).toStrictEqual(CONFIG_KEYS);
      views.forEach(v => {
        expect(v.source).toBe('default');
        const expected = v.key.startsWith('avatar.') 
          ? (DEFAULT_SETTINGS.avatar as any)[v.key.split('.')[1]]
          : (DEFAULT_SETTINGS as any)[v.key];
        expect(v.value).toStrictEqual(expected);
      });
    });

    it('reports settings.json as source (AC 14)', () => {
      const raw = JSON.stringify({ recapLang: 'es', avatar: { scale: 0.5 } });
      const views = describeConfig({}, raw);
      
      const rl = views.find(v => v.key === 'recapLang')!;
      expect(rl.value).toBe('es');
      expect(rl.source).toBe('settings.json');

      const scale = views.find(v => v.key === 'avatar.scale')!;
      expect(scale.value).toBe(0.5);
      expect(scale.source).toBe('settings.json');
    });

    it('reports env as source with precedence (AC 15)', () => {
      const raw = JSON.stringify({ recapLang: 'es' });
      const env = { FAMILIAR_RECAP_LANG: 'fr' };
      const views = describeConfig(env, raw);

      const rl = views.find(v => v.key === 'recapLang')!;
      expect(rl.value).toBe('fr');
      expect(rl.source).toBe('env');
    });

    it('falls back to settings or default if env is invalid (AC 15)', () => {
      const raw = JSON.stringify({ proactive: true });
      const env = { FAMILIAR_PROACTIVE: 'maybe' };
      const views = describeConfig(env, raw);

      const p = views.find(v => v.key === 'proactive')!;
      expect(p.value).toBe(true);
      expect(p.source).toBe('settings.json');
    });

    it('getConfigValue returns specific values or null (AC 16)', () => {
      expect(getConfigValue({}, null, 'voice')).toBe(DEFAULT_SETTINGS.voice);
      expect(getConfigValue({}, null, 'avatar.scale')).toBe(DEFAULT_SETTINGS.avatar.scale);
      expect(getConfigValue({}, null, 'nope')).toBeNull();
      expect(getConfigValue({}, null, 'avatar')).toBeNull();
    });
  });

  describe('WIZARD_STEPS', () => {
    it('has exactly the 3 required steps in order (AC 17)', () => {
      expect(WIZARD_STEPS).toHaveLength(3);
      expect(WIZARD_STEPS[0].key).toBe('voice');
      expect(WIZARD_STEPS[1].key).toBe('recapLang');
      expect(WIZARD_STEPS[2].key).toBe('proactive');
      
      expect(WIZARD_STEPS[0].choices).toStrictEqual(['say', 'elevenlabs']);
      expect(WIZARD_STEPS[1].choices).toStrictEqual(['en', 'es', 'fr', 'de', 'ja']);
      expect(WIZARD_STEPS[2].choices).toStrictEqual(['true', 'false']);
      
      WIZARD_STEPS.forEach(s => expect(typeof s.prompt).toBe('string'));
    });
  });

  describe('applyWizardAnswers', () => {
    it('applies valid answers and skips blanks (AC 18)', () => {
      const result = applyWizardAnswers(null, { voice: 'elevenlabs', recapLang: ' es ' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.text)).toStrictEqual({
          voice: 'elevenlabs',
          recapLang: 'es'
        });
      }

      const result2 = applyWizardAnswers(null, { voice: 'say', proactive: '  ' });
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(JSON.parse(result2.text)).toStrictEqual({ voice: 'say' });
      }
    });

    it('returns errors for invalid answers (AC 18)', () => {
      const result = applyWizardAnswers(null, { recapLang: 'klingon', voice: 'telepathy' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0].key).toBe('voice'); // Wizard order: voice, recapLang, proactive
        expect(result.errors[1].key).toBe('recapLang');
      }
    });

    it('yields normalized empty object for zero answers over malformed base (AC 18)', () => {
      const result = applyWizardAnswers('not-json', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe('{}\n');
      }
    });

    it('ignores non-wizard keys (AC 18)', () => {
      const result = applyWizardAnswers(null, { 'avatar.scale': '5' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.text)).toStrictEqual({});
      }
    });
  });
});
