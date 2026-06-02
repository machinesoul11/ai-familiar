import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../src/dispatch.js';
import type { DeliveryChannel, ChannelMessage, SpokenMessage, NotificationMessage, ChannelKind } from '../src/channel.js';
import type { Channel } from '../src/router.js';

interface FakeChannel extends DeliveryChannel {
  calls: ChannelMessage[];
}

function createFakeChannel(kind: ChannelKind): FakeChannel {
  return {
    kind,
    calls: [],
    deliver(message: ChannelMessage) {
      this.calls.push(message);
    }
  };
}

const spokenMsg: SpokenMessage = { kind: 'spoken', text: 'Hello' };
const notifMsg: NotificationMessage = { kind: 'notification', title: 'T', body: 'B' };

describe('Delivery Dispatcher (AC 1-11)', () => {
  it('AC1: createDispatcher([audio]) returns a function; construction calls no channel deliver', () => {
    const audio = createFakeChannel('audio');
    const dispatch = createDispatcher([audio]);
    expect(typeof dispatch).toBe('function');
    expect(audio.calls.length).toBe(0);
  });

  it('AC2: dispatch(\'audio\', spokenMsg) -> audio channel deliver called once with verbatim object', () => {
    const audio = createFakeChannel('audio');
    const dispatch = createDispatcher([audio]);
    
    dispatch('audio', spokenMsg);
    
    expect(audio.calls.length).toBe(1);
    expect(audio.calls[0]).toBe(spokenMsg); // AC7: object identity
  });

  it('AC3: dispatch(\'notification\', spokenMsg) -> audio channel deliver called once with spokenMsg (macOS-26 redirect)', () => {
    const audio = createFakeChannel('audio');
    const dispatch = createDispatcher([audio]);
    
    dispatch('notification', spokenMsg);
    
    expect(audio.calls.length).toBe(1);
    expect(audio.calls[0]).toBe(spokenMsg);
  });

  it('AC4: Both registered -> dispatch(\'notification\', m) calls audio deliver, notification fake is NOT called', () => {
    const audio = createFakeChannel('audio');
    const notif = createFakeChannel('notification');
    const dispatch = createDispatcher([notif, audio]); // order shouldn't break the redirect
    
    dispatch('notification', spokenMsg);
    
    expect(audio.calls.length).toBe(1);
    expect(notif.calls.length).toBe(0);
  });

  it('AC5: dispatch(\'none\', m) -> no channel deliver called; returns without throwing', () => {
    const audio = createFakeChannel('audio');
    const notif = createFakeChannel('notification');
    const dispatch = createDispatcher([audio, notif]);
    
    expect(() => {
      dispatch('none', spokenMsg);
    }).not.toThrow();
    
    expect(audio.calls.length).toBe(0);
    expect(notif.calls.length).toBe(0);
  });

  it('AC6: Registry miss: missing channel or empty registry -> dispatch is a no-op; no throw', () => {
    const dispatchEmpty = createDispatcher([]);
    expect(() => {
      dispatchEmpty('audio', spokenMsg);
      dispatchEmpty('notification', spokenMsg);
    }).not.toThrow();

    const dispatchNoAudio = createDispatcher([createFakeChannel('notification')]);
    expect(() => {
      dispatchNoAudio('audio', spokenMsg);
      dispatchNoAudio('notification', spokenMsg); // redirects to audio, which is missing
    }).not.toThrow();
  });

  it('AC7 & AC8: Evaluates to undefined and passes message verbatim', () => {
    const audio = createFakeChannel('audio');
    const dispatch = createDispatcher([audio]);
    
    const result = dispatch('audio', spokenMsg);
    expect(result).toBeUndefined();
    expect(audio.calls[0]).toBe(spokenMsg);
  });

  it('AC9: Order is preserved', () => {
    const audio = createFakeChannel('audio');
    const dispatch = createDispatcher([audio]);
    
    const msg1: SpokenMessage = { kind: 'spoken', text: '1' };
    const msg2: SpokenMessage = { kind: 'spoken', text: '2' };
    const msg3: SpokenMessage = { kind: 'spoken', text: '3' };
    
    dispatch('audio', msg1);
    dispatch('audio', msg2);
    dispatch('audio', msg3);
    
    expect(audio.calls.length).toBe(3);
    expect(audio.calls[0]).toBe(msg1);
    expect(audio.calls[1]).toBe(msg2);
    expect(audio.calls[2]).toBe(msg3);
  });

  it('AC10: Last-wins on duplicate kinds', () => {
    const audio1 = createFakeChannel('audio');
    const audio2 = createFakeChannel('audio');
    const dispatch = createDispatcher([audio1, audio2]);
    
    dispatch('audio', spokenMsg);
    
    expect(audio1.calls.length).toBe(0);
    expect(audio2.calls.length).toBe(1);
    expect(audio2.calls[0]).toBe(spokenMsg);
  });

  it('AC11: Totality -> no combination throws', () => {
    const audio = createFakeChannel('audio');
    const dispatch = createDispatcher([audio]);
    
    expect(() => {
      dispatch('audio', notifMsg);
      dispatch('notification', notifMsg);
      dispatch('none', notifMsg);
      dispatch('audio', spokenMsg);
      dispatch('notification', spokenMsg);
      dispatch('none', spokenMsg);
    }).not.toThrow();
  });
});