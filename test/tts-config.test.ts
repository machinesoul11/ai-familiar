import { describe, it, expect } from 'vitest';
import { resolveTtsConfig, DEFAULT_ELEVENLABS_MODEL } from '../src/ttsConfig.js';

describe('resolveTtsConfig', () => {
  it('should have the correct default model ID constant', () => {
    expect(DEFAULT_ELEVENLABS_MODEL).toBe('eleven_turbo_v2_5');
  });

  it('returns "say" provider when env is empty (AC 1)', () => {
    expect(resolveTtsConfig({})).toEqual({ provider: 'say' });
  });

  it('returns "say" provider when only API key is present (AC 2)', () => {
    expect(resolveTtsConfig({ ELEVENLABS_API_KEY: 'some-key' })).toEqual({ provider: 'say' });
  });

  it('returns "say" provider when only voice ID is present (AC 2)', () => {
    expect(resolveTtsConfig({ ELEVENLABS_VOICE_ID: 'some-voice' })).toEqual({ provider: 'say' });
  });

  it('returns "elevenlabs" provider when both key and voice ID are present (AC 3)', () => {
    const env = {
      ELEVENLABS_API_KEY: 'k',
      ELEVENLABS_VOICE_ID: 'v'
    };
    expect(resolveTtsConfig(env)).toEqual({
      provider: 'elevenlabs',
      elevenLabs: {
        apiKey: 'k',
        voiceId: 'v',
        modelId: 'eleven_turbo_v2_5'
      }
    });
  });

  it('uses ELEVENLABS_MODEL_ID override when provided (AC 4)', () => {
    const env = {
      ELEVENLABS_API_KEY: 'k',
      ELEVENLABS_VOICE_ID: 'v',
      ELEVENLABS_MODEL_ID: 'custom-model'
    };
    expect(resolveTtsConfig(env)).toEqual({
      provider: 'elevenlabs',
      elevenLabs: {
        apiKey: 'k',
        voiceId: 'v',
        modelId: 'custom-model'
      }
    });
  });

  it('returns "say" if API key or voice ID are empty strings or whitespace (AC 5)', () => {
    expect(resolveTtsConfig({ ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: 'v' })).toEqual({ provider: 'say' });
    expect(resolveTtsConfig({ ELEVENLABS_API_KEY: '  ', ELEVENLABS_VOICE_ID: 'v' })).toEqual({ provider: 'say' });
    expect(resolveTtsConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: '' })).toEqual({ provider: 'say' });
    expect(resolveTtsConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: '   ' })).toEqual({ provider: 'say' });
  });

  it('uses default model if ELEVENLABS_MODEL_ID is empty or whitespace (AC 5)', () => {
    const envBase = { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' };
    expect(resolveTtsConfig({ ...envBase, ELEVENLABS_MODEL_ID: '' }).elevenLabs?.modelId).toBe('eleven_turbo_v2_5');
    expect(resolveTtsConfig({ ...envBase, ELEVENLABS_MODEL_ID: '  ' }).elevenLabs?.modelId).toBe('eleven_turbo_v2_5');
  });

  it('keeps apiKey and voiceId verbatim (not trimmed) when valid (AC 6)', () => {
    const env = {
      ELEVENLABS_API_KEY: ' key-with-spaces ',
      ELEVENLABS_VOICE_ID: ' voice-with-spaces '
    };
    const result = resolveTtsConfig(env);
    expect(result.elevenLabs).toEqual({
      apiKey: ' key-with-spaces ',
      voiceId: ' voice-with-spaces ',
      modelId: 'eleven_turbo_v2_5'
    });
  });

  it('ignores unrelated environment variables (AC 6)', () => {
    const env = {
      ELEVENLABS_API_KEY: 'k',
      ELEVENLABS_VOICE_ID: 'v',
      OTHER_VAR: 'ignore-me'
    };
    expect(resolveTtsConfig(env)).toEqual({
      provider: 'elevenlabs',
      elevenLabs: {
        apiKey: 'k',
        voiceId: 'v',
        modelId: 'eleven_turbo_v2_5'
      }
    });
  });

  it('is deterministic and never throws (AC 6)', () => {
    const env = { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' };
    const firstCall = resolveTtsConfig(env);
    const secondCall = resolveTtsConfig(env);
    expect(firstCall).toEqual(secondCall);
    
    // Testing totality - should not throw on empty or weird records
    expect(() => resolveTtsConfig({})).not.toThrow();
    expect(() => resolveTtsConfig({ SOME_VAR: undefined })).not.toThrow();
  });
});
