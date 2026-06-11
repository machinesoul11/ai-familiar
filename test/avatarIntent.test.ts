import { describe, it, expect, vi } from 'vitest';
import { parseIntent, createAvatarIntentHandler } from '../src/avatarIntent.js';
import type { AvatarIntent, AvatarIntentActions } from '../src/avatarIntent.js';

describe('avatarIntent', () => {
  describe('parseIntent', () => {
    it('1. valid frame parses', () => {
      const raw = '{"kind":"avatar-intent","intent":"pull-recap"}';
      const result = parseIntent(raw);
      expect(result).toEqual({ kind: 'avatar-intent', intent: 'pull-recap' });
    });

    it('2. separate calls return distinct objects', () => {
      const raw = '{"kind":"avatar-intent","intent":"pull-recap"}';
      const r1 = parseIntent(raw);
      const r2 = parseIntent(raw);
      expect(r1).not.toBe(r2);
      expect(r1).toEqual(r2);
      
      // Mutating one shouldn't affect the other
      if (r1) {
        (r1 as any).intent = 'mutated';
        expect(r2?.intent).toBe('pull-recap');
      }
    });

    it('3. invalid JSON returns null', () => {
      expect(parseIntent('not json')).toBeNull();
      expect(parseIntent('{')).toBeNull();
      expect(parseIntent('')).toBeNull();
    });

    it('4. valid JSON that is NOT a plain object returns null', () => {
      expect(parseIntent('[]')).toBeNull();
      expect(parseIntent('null')).toBeNull();
      expect(parseIntent('"x"')).toBeNull();
      expect(parseIntent('5')).toBeNull();
      expect(parseIntent('true')).toBeNull();
    });

    it('5. plain object missing kind returns null', () => {
      expect(parseIntent('{"intent":"pull-recap"}')).toBeNull();
    });

    it('6. plain object with a wrong kind string returns null', () => {
      expect(parseIntent('{"kind":"tap","intent":"pull-recap"}')).toBeNull();
      expect(parseIntent('{"kind":"avatar-command","intent":"pull-recap"}')).toBeNull();
    });

    it('7. plain object whose kind is a non-string type returns null', () => {
      expect(parseIntent('{"kind":123,"intent":"pull-recap"}')).toBeNull();
      expect(parseIntent('{"kind":{},"intent":"pull-recap"}')).toBeNull();
      expect(parseIntent('{"kind":[],"intent":"pull-recap"}')).toBeNull();
    });

    it('8. plain object with correct kind but missing intent returns null', () => {
      expect(parseIntent('{"kind":"avatar-intent"}')).toBeNull();
    });

    it('9. plain object with correct kind but a non-string intent returns null', () => {
      expect(parseIntent('{"kind":"avatar-intent","intent":123}')).toBeNull();
      expect(parseIntent('{"kind":"avatar-intent","intent":{}}')).toBeNull();
    });

    it('10. plain object with correct kind but an unknown intent string returns null', () => {
      expect(parseIntent('{"kind":"avatar-intent","intent":"frobnicate"}')).toBeNull();
    });

    it('11. plain object with correct kind + intent plus extra fields ignores extra fields', () => {
      const raw = '{"kind":"avatar-intent","intent":"pull-recap","extra":1,"ts":"2026"}';
      const result = parseIntent(raw);
      expect(result).toEqual({ kind: 'avatar-intent', intent: 'pull-recap' });
      if (result) {
        expect(Object.keys(result).sort()).toEqual(['intent', 'kind']);
      }
    });

    it('12. whitespace-only input returns null', () => {
      expect(parseIntent('   ')).toBeNull();
      expect(parseIntent('\n')).toBeNull();
    });

    it('13. totality: never throws for hostile strings', () => {
      const hostileStrings = [
        '{}garbage',
        '{"kind":"avatar-intent","intent":"pull-recap"}extra',
        'unicode: 🌈',
        'A'.repeat(10000),
        '\x00\x01\x02'
      ];
      for (const s of hostileStrings) {
        expect(() => parseIntent(s)).not.toThrow();
      }
    });
  });

  describe('createAvatarIntentHandler', () => {
    it('14. returns a function', () => {
      const actions: AvatarIntentActions = { pullRecap: vi.fn() };
      const handler = createAvatarIntentHandler(actions);
      expect(typeof handler).toBe('function');
    });

    it('15. construction does not call action', () => {
      const pullRecap = vi.fn();
      const actions: AvatarIntentActions = { pullRecap };
      createAvatarIntentHandler(actions);
      expect(pullRecap).not.toHaveBeenCalled();
    });

    it('16. dispatch calls pullRecap exactly once with zero args', () => {
      const pullRecap = vi.fn();
      const actions: AvatarIntentActions = { pullRecap };
      const handler = createAvatarIntentHandler(actions);
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'pull-recap' };
      
      handler(intent);
      
      expect(pullRecap).toHaveBeenCalledTimes(1);
      expect(pullRecap).toHaveBeenCalledWith();
    });

    it('17. dispatching same intent 3 times calls action 3 times', () => {
      const pullRecap = vi.fn();
      const actions: AvatarIntentActions = { pullRecap };
      const handler = createAvatarIntentHandler(actions);
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'pull-recap' };
      
      handler(intent);
      handler(intent);
      handler(intent);
      
      expect(pullRecap).toHaveBeenCalledTimes(3);
    });

    it('18. separate handlers are independent', () => {
      const pullRecapA = vi.fn();
      const pullRecapB = vi.fn();
      
      const handlerA = createAvatarIntentHandler({ pullRecap: pullRecapA });
      const handlerB = createAvatarIntentHandler({ pullRecap: pullRecapB });
      
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'pull-recap' };
      
      handlerA(intent);
      
      expect(pullRecapA).toHaveBeenCalledTimes(1);
      expect(pullRecapB).not.toHaveBeenCalled();
      
      handlerB(intent);
      expect(pullRecapB).toHaveBeenCalledTimes(1);
    });
  });
});
