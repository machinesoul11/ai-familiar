import { describe, it, expect } from 'vitest';
import type { AvatarIntent } from '../src/avatarIntent.js';
import { resolveIntentAction } from '../src/intentPolicy.js';

describe('intentPolicy', () => {
  const configs = [
    { stt: true, stop: true },
    { stt: true, stop: false },
    { stt: false, stop: true },
    { stt: false, stop: false },
  ];
  const speakingStates = [true, false];

  it('AC-1: AC-pullrecap — \'pull-recap\' intent -> \'pull-recap\' under every combination', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'pull-recap' };
    for (const config of configs) {
      for (const isSpeaking of speakingStates) {
        expect(resolveIntentAction(intent, config, isSpeaking)).toBe('pull-recap');
      }
    }
  });

  it('AC-2: AC-recall — \'recall\' intent -> \'recall\' under every combination', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'recall' };
    for (const config of configs) {
      for (const isSpeaking of speakingStates) {
        expect(resolveIntentAction(intent, config, isSpeaking)).toBe('recall');
      }
    }
  });

  it('AC-3: AC-stop-on — explicit \'stop\' intent with stop:true -> \'stop\'', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'stop' };
    for (const isSpeaking of speakingStates) {
      expect(resolveIntentAction(intent, { stt: true, stop: true }, isSpeaking)).toBe('stop');
      expect(resolveIntentAction(intent, { stt: false, stop: true }, isSpeaking)).toBe('stop');
    }
  });

  it('AC-4: AC-stop-off — explicit \'stop\' intent with stop:false -> \'none\'', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'stop' };
    for (const isSpeaking of speakingStates) {
      expect(resolveIntentAction(intent, { stt: true, stop: false }, isSpeaking)).toBe('none');
      expect(resolveIntentAction(intent, { stt: false, stop: false }, isSpeaking)).toBe('none');
    }
  });

  it('AC-5: AC-tap-speaking-stop-on — \'tap\', isSpeaking:true, stop:true -> \'stop\'', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'tap' };
    expect(resolveIntentAction(intent, { stt: true, stop: true }, true)).toBe('stop');
    expect(resolveIntentAction(intent, { stt: false, stop: true }, true)).toBe('stop');
  });

  it('AC-6: AC-tap-speaking-stop-off — \'tap\', isSpeaking:true, stop:false -> \'none\'', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'tap' };
    expect(resolveIntentAction(intent, { stt: true, stop: false }, true)).toBe('none');
    expect(resolveIntentAction(intent, { stt: false, stop: false }, true)).toBe('none');
  });

  it('AC-7: AC-tap-idle — \'tap\', isSpeaking:false -> \'pull-recap\'', () => {
    const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'tap' };
    for (const config of configs) {
      expect(resolveIntentAction(intent, config, false)).toBe('pull-recap');
    }
  });

  it('AC-8: AC-utterance-stt-off — \'utterance\' with stt:false -> \'none\'', () => {
    const intentRecap: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text: 'recap' };
    const intentRecall: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text: 'recall' };
    const intentStop: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text: 'stop' };
    
    for (const isSpeaking of speakingStates) {
      expect(resolveIntentAction(intentRecap, { stt: false, stop: true }, isSpeaking)).toBe('none');
      expect(resolveIntentAction(intentRecap, { stt: false, stop: false }, isSpeaking)).toBe('none');
      
      expect(resolveIntentAction(intentRecall, { stt: false, stop: true }, isSpeaking)).toBe('none');
      expect(resolveIntentAction(intentRecall, { stt: false, stop: false }, isSpeaking)).toBe('none');
      
      expect(resolveIntentAction(intentStop, { stt: false, stop: true }, isSpeaking)).toBe('none');
      expect(resolveIntentAction(intentStop, { stt: false, stop: false }, isSpeaking)).toBe('none');
    }
  });

  it('AC-9: AC-utterance-recap — \'utterance\' text classifying as pull-recap, stt:true -> \'pull-recap\'', () => {
    const texts = ['recap', 'what happened', 'summary'];
    for (const text of texts) {
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text };
      expect(resolveIntentAction(intent, { stt: true, stop: true }, false)).toBe('pull-recap');
      expect(resolveIntentAction(intent, { stt: true, stop: false }, false)).toBe('pull-recap');
    }
  });

  it('AC-10: AC-utterance-recall — \'utterance\' text classifying as recall, stt:true -> \'recall\'', () => {
    const texts = ['recall', 'what did i miss', 'catch me up'];
    for (const text of texts) {
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text };
      expect(resolveIntentAction(intent, { stt: true, stop: true }, false)).toBe('recall');
      expect(resolveIntentAction(intent, { stt: true, stop: false }, false)).toBe('recall');
    }
  });

  it('AC-11: AC-utterance-stop-on — \'utterance\' text classifying as stop, stt:true, stop:true -> \'stop\'', () => {
    const texts = ['stop', 'quiet', 'silence', 'shush'];
    for (const text of texts) {
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text };
      expect(resolveIntentAction(intent, { stt: true, stop: true }, false)).toBe('stop');
      expect(resolveIntentAction(intent, { stt: true, stop: true }, true)).toBe('stop');
    }
  });

  it('AC-12: AC-utterance-stop-off — \'utterance\' text classifying as stop, stt:true, stop:false -> \'none\'', () => {
    const texts = ['stop', 'quiet', 'silence', 'shush'];
    for (const text of texts) {
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text };
      expect(resolveIntentAction(intent, { stt: true, stop: false }, false)).toBe('none');
      expect(resolveIntentAction(intent, { stt: true, stop: false }, true)).toBe('none');
    }
  });

  it('AC-13: AC-utterance-unrecognized — \'utterance\' text classifying as null, stt:true -> \'none\'', () => {
    const texts = ['', 'hello there', 'banana'];
    for (const text of texts) {
      const intent: AvatarIntent = { kind: 'avatar-intent', intent: 'utterance', text };
      for (const stopSetting of [true, false]) {
        for (const isSpeaking of speakingStates) {
          expect(resolveIntentAction(intent, { stt: true, stop: stopSetting }, isSpeaking)).toBe('none');
        }
      }
    }
  });

  it('AC-14: AC-default-no-regression — with {stt:true, stop:true}, matches legacy mapping', () => {
    const config = { stt: true, stop: true };
    const speaking = true;
    const idle = false;
    
    // pull-recap -> pull-recap
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'pull-recap' }, config, speaking)).toBe('pull-recap');
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'pull-recap' }, config, idle)).toBe('pull-recap');
    
    // recall -> recall
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'recall' }, config, speaking)).toBe('recall');
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'recall' }, config, idle)).toBe('recall');
    
    // explicit stop -> stop
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'stop' }, config, speaking)).toBe('stop');
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'stop' }, config, idle)).toBe('stop');
    
    // tap(speaking) -> stop
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'tap' }, config, speaking)).toBe('stop');
    
    // tap(idle) -> pull-recap
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'tap' }, config, idle)).toBe('pull-recap');
    
    // utterance (stop) -> stop
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'utterance', text: 'quiet' }, config, idle)).toBe('stop');
    
    // utterance (recall) -> recall
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'utterance', text: 'what did i miss' }, config, idle)).toBe('recall');
    
    // utterance (pull-recap) -> pull-recap
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'utterance', text: 'recap' }, config, idle)).toBe('pull-recap');
    
    // utterance (null) -> none
    expect(resolveIntentAction({ kind: 'avatar-intent', intent: 'utterance', text: 'hello' }, config, idle)).toBe('none');
  });

  it('AC-15: AC-total — never throws and always returns valid IntentAction string', () => {
    const intents: AvatarIntent[] = [
      { kind: 'avatar-intent', intent: 'pull-recap' },
      { kind: 'avatar-intent', intent: 'recall' },
      { kind: 'avatar-intent', intent: 'stop' },
      { kind: 'avatar-intent', intent: 'tap' },
      { kind: 'avatar-intent', intent: 'utterance', text: 'recap' },
      { kind: 'avatar-intent', intent: 'utterance', text: 'hello' },
    ];
    const validResults = ['pull-recap', 'recall', 'stop', 'none'];
    
    for (const intent of intents) {
      for (const config of configs) {
        for (const isSpeaking of speakingStates) {
          expect(() => {
            const result = resolveIntentAction(intent, config, isSpeaking);
            expect(validResults).toContain(result);
          }).not.toThrow();
        }
      }
    }
  });
});
