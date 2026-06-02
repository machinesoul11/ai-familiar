import { describe, it, expect } from 'vitest';
import { createAvatarChannel } from '../src/avatarChannel.js';
import type { AvatarBackend, AvatarCommand } from '../src/avatarChannel.js';
import { createTtsChannel } from '../src/ttsChannel.js';
import { createNotificationChannel } from '../src/notificationChannel.js';
import type {
  DeliveryChannel,
  ChannelMessage,
  AvatarPhase,
  AvatarMood,
  SpokenMessage,
  NotificationMessage
} from '../src/channel.js';

class RecordingAvatarBackend implements AvatarBackend {
  calls: AvatarCommand[] = [];
  render(command: AvatarCommand): void {
    this.calls.push(command);
  }
}

describe('Avatar Channel (Contract 4.1)', () => {
  it('AC 1: createAvatarChannel(backend).kind === "visual" and satisfies DeliveryChannel', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    expect(channel.kind).toBe('visual');
    expect(typeof channel.deliver).toBe('function');
  });

  it('AC 2: deliver({ kind: "avatar-state", phase: "working", ready: true }) -> render called exactly once with projection', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    channel.deliver({ kind: 'avatar-state', phase: 'working', ready: true });
    expect(backend.calls).toEqual([{ kind: 'state', phase: 'working', ready: true }]);
  });

  it('AC 3: All four phases with ready: true and ready: false forward matching command', () => {
    const phases: AvatarPhase[] = ['idle', 'working', 'blocked', 'done'];
    for (const phase of phases) {
      for (const ready of [true, false]) {
        const backend = new RecordingAvatarBackend();
        const channel = createAvatarChannel(backend);
        channel.deliver({ kind: 'avatar-state', phase, ready });
        expect(backend.calls).toEqual([{ kind: 'state', phase, ready }]);
      }
    }
  });

  it('AC 4: All four moods forward matching command', () => {
    const moods: AvatarMood[] = ['neutral', 'happy', 'thinking', 'alert'];
    for (const mood of moods) {
      const backend = new RecordingAvatarBackend();
      const channel = createAvatarChannel(backend);
      channel.deliver({ kind: 'avatar-expression', mood });
      expect(backend.calls).toEqual([{ kind: 'expression', mood }]);
    }
  });

  it('AC 5: deliver({ kind: "avatar-thought", text: "..." }) -> render once with verbatim text', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    const text = 'Refactoring the router.';
    channel.deliver({ kind: 'avatar-thought', text });
    expect(backend.calls).toEqual([{ kind: 'thought', text }]);
  });

  it('AC 6: Verbatim thought: spaces are preserved', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    const text = '  spaced  ';
    channel.deliver({ kind: 'avatar-thought', text });
    expect(backend.calls[0]).toEqual({ kind: 'thought', text: '  spaced  ' });
  });

  it('AC 7: ready strict-coercion: non-true values coerce to false but render is still called', () => {
    const nonTrueValues = [1, 'yes', 0, undefined, null, {}];
    for (const val of nonTrueValues) {
      const backend = new RecordingAvatarBackend();
      const channel = createAvatarChannel(backend);
      channel.deliver({ kind: 'avatar-state', phase: 'idle', ready: val } as unknown as ChannelMessage);
      expect(backend.calls).toEqual([{ kind: 'state', phase: 'idle', ready: false }]);
    }
  });

  it('AC 8: Invalid phase (cast) -> render not called', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    channel.deliver({ kind: 'avatar-state', phase: 'frobnicate', ready: true } as unknown as ChannelMessage);
    expect(backend.calls.length).toBe(0);
  });

  it('AC 9: Invalid mood (cast) -> render not called', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    channel.deliver({ kind: 'avatar-expression', mood: 'ecstatic' } as unknown as ChannelMessage);
    expect(backend.calls.length).toBe(0);
  });

  it('AC 10: Empty / whitespace thought -> render not called', () => {
    const invalidTexts = ['', '   ', '\n\t '];
    for (const text of invalidTexts) {
      const backend = new RecordingAvatarBackend();
      const channel = createAvatarChannel(backend);
      channel.deliver({ kind: 'avatar-thought', text });
      expect(backend.calls.length).toBe(0);
    }
  });

  it('AC 11: Non-string thought text (cast) -> render not called', () => {
    const nonStrings = [123, null, {}, true];
    for (const text of nonStrings) {
      const backend = new RecordingAvatarBackend();
      const channel = createAvatarChannel(backend);
      channel.deliver({ kind: 'avatar-thought', text } as unknown as ChannelMessage);
      expect(backend.calls.length).toBe(0);
    }
  });

  it('AC 12: Non-avatar message (spoken, notification, unknown) -> render not called', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    
    channel.deliver({ kind: 'spoken', text: 'hello' } as SpokenMessage);
    channel.deliver({ kind: 'notification', title: 't', body: 'b' } as NotificationMessage);
    channel.deliver({ kind: 'unknown' } as unknown as ChannelMessage);
    
    expect(backend.calls.length).toBe(0);
  });

  it('AC 13: Throwing backend -> deliver swallows it and returns normally', () => {
    const throwingBackend: AvatarBackend = {
      render() { throw new Error('boom'); }
    };
    const channel = createAvatarChannel(throwingBackend);
    expect(() => {
      channel.deliver({ kind: 'avatar-expression', mood: 'happy' });
    }).not.toThrow();
  });

  it('AC 14: deliver(...) evaluates to undefined', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    const result = channel.deliver({ kind: 'avatar-expression', mood: 'happy' });
    expect(result).toBeUndefined();
  });

  it('AC 15: Fire-and-forget ordering: calls are preserved in order', () => {
    const backend = new RecordingAvatarBackend();
    const channel = createAvatarChannel(backend);
    
    channel.deliver({ kind: 'avatar-state', phase: 'working', ready: true });
    channel.deliver({ kind: 'avatar-expression', mood: 'thinking' });
    channel.deliver({ kind: 'avatar-thought', text: 'Processing...' });
    
    expect(backend.calls).toEqual([
      { kind: 'state', phase: 'working', ready: true },
      { kind: 'expression', mood: 'thinking' },
      { kind: 'thought', text: 'Processing...' }
    ]);
  });

  it('AC 16: Construction does not call backend.render', () => {
    const backend = new RecordingAvatarBackend();
    createAvatarChannel(backend);
    expect(backend.calls.length).toBe(0);
  });

  it('AC 17: Totality: deliver never throws regardless of input or backend', () => {
    const throwingBackend: AvatarBackend = {
      render() { throw new Error('boom'); }
    };
    const channel = createAvatarChannel(throwingBackend);
    
    const chaoticInputs = [
      { kind: 'avatar-state', phase: 'invalid', ready: 'garbage' },
      { kind: 'avatar-thought', text: null },
      { kind: 'spoken', text: 'ignored' },
      {},
      { kind: 'avatar-expression', mood: 'happy' }
    ];

    for (const input of chaoticInputs) {
      expect(() => channel.deliver(input as unknown as ChannelMessage)).not.toThrow();
    }
  });

  it('AC 18: Seam-holds: createTtsChannel ignores avatar messages', () => {
    const speechCalls: string[] = [];
    const speechBackend = {
      speak(text: string) { speechCalls.push(text); }
    };
    const ttsChannel = createTtsChannel(speechBackend);
    
    ttsChannel.deliver({ kind: 'avatar-thought', text: 'should be ignored' } as any);
    ttsChannel.deliver({ kind: 'avatar-state', phase: 'working', ready: true } as any);
    
    expect(speechCalls.length).toBe(0);
  });

  it('AC 19: Seam-holds: createNotificationChannel ignores avatar messages', () => {
    const notifyCalls: Array<[string, string]> = [];
    const notifyBackend = {
      notify(title: string, body: string) { notifyCalls.push([title, body]); }
    };
    const notificationChannel = createNotificationChannel(notifyBackend);
    
    notificationChannel.deliver({ kind: 'avatar-state', phase: 'idle', ready: false } as any);
    notificationChannel.deliver({ kind: 'avatar-expression', mood: 'alert' } as any);
    
    expect(notifyCalls.length).toBe(0);
  });

  it('AC 20: createAvatarChannel ignores spoken/notification messages', () => {
    const backend = new RecordingAvatarBackend();
    const avatarChannel = createAvatarChannel(backend);
    
    avatarChannel.deliver({ kind: 'spoken', text: 'ignored' } as any);
    avatarChannel.deliver({ kind: 'notification', title: 't', body: 'b' } as any);
    
    expect(backend.calls.length).toBe(0);
  });
});
