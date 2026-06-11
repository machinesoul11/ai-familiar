import { describe, it, expect, vi } from 'vitest';
import { parseIntent, createAvatarIntentHandler } from '../src/avatarIntent.js';
import type { AvatarIntent, AvatarIntentActions } from '../src/avatarIntent.js';

describe('avatarIntent', () => {
  describe('parseIntent', () => {
    // AC 1: {kind:'avatar-intent',intent:'utterance',text:'recap'} parses to exactly {kind:'avatar-intent',intent:'utterance',text:'recap'}.
    it('1. parses utterance intent correctly', () => {
      const raw = '{"kind":"avatar-intent","intent":"utterance","text":"recap"}';
      const result = parseIntent(raw);
      expect(result).toEqual({ kind: 'avatar-intent', intent: 'utterance', text: 'recap' });
    });

    // AC 2: text preserved verbatim incl. case/whitespace: input text '  ReCap NOW ' round-trips unchanged (text === '  ReCap NOW ').
    it('2. preserves text verbatim including case and whitespace', () => {
      const raw = '{"kind":"avatar-intent","intent":"utterance","text":"  ReCap NOW "}';
      const result = parseIntent(raw);
      expect(result).toEqual({ kind: 'avatar-intent', intent: 'utterance', text: '  ReCap NOW ' });
    });

    // AC 3: text:'' (empty string) → valid, returns {kind:'avatar-intent',intent:'utterance',text:''} (NOT null).
    it('3. accepts empty string as valid text', () => {
      const raw = '{"kind":"avatar-intent","intent":"utterance","text":""}';
      const result = parseIntent(raw);
      expect(result).toEqual({ kind: 'avatar-intent', intent: 'utterance', text: '' });
    });

    // AC 4: utterance with MISSING text → null.
    it('4. returns null if text is missing in utterance intent', () => {
      const raw = '{"kind":"avatar-intent","intent":"utterance"}';
      expect(parseIntent(raw)).toBeNull();
    });

    // AC 5: utterance with non-string text → null: one case each for number, boolean, null, object, array.
    it('5. returns null if text is not a string', () => {
      const cases = [
        '{"kind":"avatar-intent","intent":"utterance","text":123}',
        '{"kind":"avatar-intent","intent":"utterance","text":true}',
        '{"kind":"avatar-intent","intent":"utterance","text":null}',
        '{"kind":"avatar-intent","intent":"utterance","text":{}}',
        '{"kind":"avatar-intent","intent":"utterance","text":[]}'
      ];
      for (const c of cases) {
        expect(parseIntent(c)).toBeNull();
      }
    });

    // AC 6: utterance with extra fields → returned object has ONLY kind/intent/text; and is a fresh object.
    it('6. strips extra fields and returns a fresh object', () => {
      const raw = '{"kind":"avatar-intent","intent":"utterance","text":"hi","foo":1,"bar":true}';
      const result = parseIntent(raw);
      expect(result).toEqual({ kind: 'avatar-intent', intent: 'utterance', text: 'hi' });
      if (result) {
        expect(Object.keys(result).sort()).toEqual(['intent', 'kind', 'text']);
      }

      const result2 = parseIntent(raw);
      expect(result).not.toBe(result2);
      if (result && result2 && 'text' in result && 'text' in result2) {
        result.text = 'mutated';
        expect(result2.text).toBe('hi');
      }
    });

    // AC 7: Existing intents unchanged: 'pull-recap' → {kind:'avatar-intent',intent:'pull-recap'}; 'recall' → {kind:'avatar-intent',intent:'recall'}.
    it('7. handles existing pull-recap and recall intents correctly', () => {
      expect(parseIntent('{"kind":"avatar-intent","intent":"pull-recap"}')).toEqual({ kind: 'avatar-intent', intent: 'pull-recap' });
      expect(parseIntent('{"kind":"avatar-intent","intent":"recall"}')).toEqual({ kind: 'avatar-intent', intent: 'recall' });
    });

    // AC 8: Unknown intent → null; non-object → null; missing kind → null; wrong kind → null; invalid JSON → null; whitespace-only → null; never throws.
    it('8. handles invalid and unknown inputs gracefully', () => {
      // Unknown intent
      expect(parseIntent('{"kind":"avatar-intent","intent":"unknown"}')).toBeNull();
      // Non-object
      expect(parseIntent('[]')).toBeNull();
      expect(parseIntent('null')).toBeNull();
      expect(parseIntent('"x"')).toBeNull();
      expect(parseIntent('5')).toBeNull();
      expect(parseIntent('true')).toBeNull();
      // Missing/Wrong kind
      expect(parseIntent('{"intent":"pull-recap"}')).toBeNull();
      expect(parseIntent('{"kind":"wrong","intent":"pull-recap"}')).toBeNull();
      // Invalid JSON
      expect(parseIntent('not json')).toBeNull();
      expect(parseIntent('{')).toBeNull();
      expect(parseIntent('')).toBeNull();
      // Whitespace-only
      expect(parseIntent('   ')).toBeNull();
      expect(parseIntent('\n')).toBeNull();
      // Never throws
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
    // Helper to create all mocks
    const createMocks = () => ({
      pullRecap: vi.fn(),
      recall: vi.fn(),
      utterance: vi.fn()
    });

    // AC 17: {kind:'avatar-intent',intent:'utterance',text:'foo'} → calls actions.utterance exactly once with 'foo'; does NOT call pullRecap or recall.
    it('17. calls utterance action with correct text', () => {
      const actions = createMocks();
      const handler = createAvatarIntentHandler(actions);
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text: 'foo' };
      
      handler(intent);
      
      expect(actions.utterance).toHaveBeenCalledTimes(1);
      expect(actions.utterance).toHaveBeenCalledWith('foo');
      expect(actions.pullRecap).not.toHaveBeenCalled();
      expect(actions.recall).not.toHaveBeenCalled();
    });

    // AC 18: Existing routing unchanged: 'pull-recap' → actions.pullRecap() exactly once; 'recall' → actions.recall() exactly once.
    it('18. routes pull-recap and recall correctly', () => {
      const actions = createMocks();
      const handler = createAvatarIntentHandler(actions);
      
      handler({ kind: 'avatar-intent', intent: 'pull-recap' });
      expect(actions.pullRecap).toHaveBeenCalledTimes(1);
      expect(actions.pullRecap).toHaveBeenCalledWith();
      expect(actions.recall).not.toHaveBeenCalled();
      expect(actions.utterance).not.toHaveBeenCalled();

      actions.pullRecap.mockClear();
      
      handler({ kind: 'avatar-intent', intent: 'recall' });
      expect(actions.recall).toHaveBeenCalledTimes(1);
      expect(actions.recall).toHaveBeenCalledWith();
      expect(actions.pullRecap).not.toHaveBeenCalled();
      expect(actions.utterance).not.toHaveBeenCalled();
    });

    // AC 19: The handler forwards text raw — it does NOT transform/classify the text.
    it('19. forwards utterance text verbatim', () => {
      const actions = createMocks();
      const handler = createAvatarIntentHandler(actions);
      const rawText = 'WHAT DID I MISS';
      
      handler({ kind: 'avatar-intent', intent: 'utterance', text: rawText });
      
      expect(actions.utterance).toHaveBeenCalledWith(rawText);
      // Ensure it wasn't called with 'recall' just because the text implies it
      expect(actions.utterance).not.toHaveBeenCalledWith('recall');
    });

    // Sanity checks
    it('sanity: returns a function', () => {
      const handler = createAvatarIntentHandler(createMocks());
      expect(typeof handler).toBe('function');
    });

    it('sanity: construction does not call action', () => {
      const actions = createMocks();
      createAvatarIntentHandler(actions);
      expect(actions.pullRecap).not.toHaveBeenCalled();
      expect(actions.recall).not.toHaveBeenCalled();
      expect(actions.utterance).not.toHaveBeenCalled();
    });

    it('sanity: dispatching same intent N times calls the action N times', () => {
      const actions = createMocks();
      const handler = createAvatarIntentHandler(actions);
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'pull-recap' };
      
      handler(intent);
      handler(intent);
      handler(intent);
      
      expect(actions.pullRecap).toHaveBeenCalledTimes(3);
    });

    it('sanity: separate handlers are independent', () => {
      const actionsA = createMocks();
      const actionsB = createMocks();
      
      const handlerA = createAvatarIntentHandler(actionsA);
      const handlerB = createAvatarIntentHandler(actionsB);
      
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'pull-recap' };
      
      handlerA(intent);
      
      expect(actionsA.pullRecap).toHaveBeenCalledTimes(1);
      expect(actionsB.pullRecap).not.toHaveBeenCalled();
      
      handlerB(intent);
      expect(actionsB.pullRecap).toHaveBeenCalledTimes(1);
    });
  });
});
