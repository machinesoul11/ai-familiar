import { describe, it, expect } from 'vitest';
import { buildTtsRequest } from '../src/elevenLabsRequest.js';

describe('buildTtsRequest', () => {
  it('builds a correct request for valid input (AC 7)', () => {
    const settings = {
      apiKey: 'k',
      voiceId: 'v',
      modelId: 'm'
    };
    const text = 'hi';
    
    const result = buildTtsRequest({ text, settings });
    
    expect(result.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v');
    expect(result.headers).toEqual({
      'xi-api-key': 'k',
      'content-type': 'application/json',
      'accept': 'audio/mpeg'
    });
    
    const body = JSON.parse(result.body);
    expect(body).toEqual({
      text: 'hi',
      model_id: 'm'
    });
  });

  it('reflects different voiceId in the URL path (AC 8)', () => {
    const settings = { apiKey: 'k', voiceId: 'another-voice', modelId: 'm' };
    const result = buildTtsRequest({ text: 'hi', settings });
    expect(result.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/another-voice');
  });

  it('reflects text and modelId in the body verbatim (AC 8)', () => {
    const settings = { apiKey: 'k', voiceId: 'v', modelId: 'specific-model' };
    const text = 'Specific text for TTS';
    const result = buildTtsRequest({ text, settings });
    
    const body = JSON.parse(result.body);
    expect(body.text).toBe(text);
    expect(body.model_id).toBe('specific-model');
  });

  it('is deterministic and never throws (AC 8)', () => {
    const input = {
      text: 'test',
      settings: { apiKey: 'k', voiceId: 'v', modelId: 'm' }
    };
    const firstCall = buildTtsRequest(input);
    const secondCall = buildTtsRequest(input);
    expect(firstCall).toEqual(secondCall);
    
    // Test that it doesn't throw even with unusual (but type-valid) strings
    expect(() => buildTtsRequest({ text: '', settings: { apiKey: '', voiceId: '', modelId: '' } })).not.toThrow();
  });
});
