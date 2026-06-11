import { describe, it, expect, vi } from 'vitest';
import { parseIntent, createAvatarIntentHandler } from '../src/avatarIntent.js';

describe('avatarIntent recall', () => {
  it('parses "recall" intent as a fresh object (AC 18)', () => {
    const raw = '{"kind":"avatar-intent","intent":"recall"}';
    const result = parseIntent(raw);
    expect(result).toEqual({ kind: 'avatar-intent', intent: 'recall' });
    
    const result2 = parseIntent(raw);
    expect(result).not.toBe(result2);
  });

  it('still returns the pull-recap intent for the pull-recap frame (AC 19)', () => {
    const raw = '{"kind":"avatar-intent","intent":"pull-recap"}';
    const result = parseIntent(raw);
    expect(result).toEqual({ kind: 'avatar-intent', intent: 'pull-recap' });
  });

  it('returns null for unknown intent values, bad JSON, non-objects, or wrong kind (AC 19)', () => {
    expect(parseIntent('{"kind":"avatar-intent","intent":"unknown"}')).toBeNull();
    expect(parseIntent('not json')).toBeNull();
    expect(parseIntent('42')).toBeNull();
    expect(parseIntent('{"kind":"wrong-kind","intent":"recall"}')).toBeNull();
    expect(parseIntent('{"intent":"recall"}')).toBeNull();
  });

  it('routes "recall" and "pull-recap" intents correctly without cross-firing (AC 20)', () => {
    const pullRecap = vi.fn();
    const recall = vi.fn();
    const handler = createAvatarIntentHandler({ pullRecap, recall });

    handler({ kind: 'avatar-intent', intent: 'recall' });
    expect(recall).toHaveBeenCalledTimes(1);
    expect(pullRecap).not.toHaveBeenCalled();

    recall.mockClear();
    
    handler({ kind: 'avatar-intent', intent: 'pull-recap' });
    expect(pullRecap).toHaveBeenCalledTimes(1);
    expect(recall).not.toHaveBeenCalled();
  });
});
