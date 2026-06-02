import { describe, it, expect } from 'vitest';
import { createTtsChannel } from '../src/ttsChannel.js';
import type { SpeechBackend } from '../src/ttsChannel.js';
import type { DeliveryChannel, ChannelMessage } from '../src/channel.js';

describe('TTS Channel', () => {
  const createRecordingBackend = () => {
    return {
      calls: [] as string[],
      speak(t: string) {
        this.calls.push(t);
      }
    };
  };

  it('satisfies AC 1 & 10: has kind === "audio" and does not call backend on construction', () => {
    const backend = createRecordingBackend();
    const channel: DeliveryChannel = createTtsChannel(backend);
    
    expect(channel.kind).toBe('audio');
    expect(backend.calls).toHaveLength(0);
  });

  it('satisfies AC 2 & 9: delivers a "spoken" message exactly once with the text, returning undefined', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    const result = channel.deliver({ kind: 'spoken', text: 'Run landed.' });
    
    expect(backend.calls).toEqual(['Run landed.']);
    expect(result).toBeUndefined();
  });

  it('satisfies AC 3: preserves surrounding spaces (verbatim)', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    channel.deliver({ kind: 'spoken', text: ' hi there ' });
    
    expect(backend.calls).toEqual([' hi there ']);
  });

  it('satisfies AC 4 & 11: skips empty text without throwing', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    expect(() => {
      const result = channel.deliver({ kind: 'spoken', text: '' });
      expect(result).toBeUndefined();
    }).not.toThrow();
    
    expect(backend.calls).toHaveLength(0);
  });

  it('satisfies AC 5 & 11: skips whitespace-only text without throwing', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    expect(() => {
      channel.deliver({ kind: 'spoken', text: '   ' });
      channel.deliver({ kind: 'spoken', text: '\n\t ' });
    }).not.toThrow();
    
    expect(backend.calls).toHaveLength(0);
  });

  it('satisfies AC 6 & 11: ignores non-"spoken" messages without throwing', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    expect(() => {
      channel.deliver({ kind: 'notification', body: 'x' } as unknown as ChannelMessage);
    }).not.toThrow();
    
    expect(backend.calls).toHaveLength(0);
  });

  it('satisfies AC 7 & 11: swallows backend exceptions and returns normally', () => {
    const throwingBackend: SpeechBackend = {
      speak() {
        throw new Error('boom');
      }
    };
    const channel = createTtsChannel(throwingBackend);
    
    expect(() => {
      const result = channel.deliver({ kind: 'spoken', text: 'crash me' });
      expect(result).toBeUndefined();
    }).not.toThrow();
  });

  it('satisfies AC 8: calls backend.speak in call order for multiple deliveries', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    channel.deliver({ kind: 'spoken', text: 'one' });
    channel.deliver({ kind: 'spoken', text: 'two' });
    channel.deliver({ kind: 'spoken', text: 'three' });
    
    expect(backend.calls).toEqual(['one', 'two', 'three']);
  });

  it('satisfies AC 11: ignores non-string text when constructed via cast, without throwing', () => {
    const backend = createRecordingBackend();
    const channel = createTtsChannel(backend);
    
    expect(() => {
      channel.deliver({ kind: 'spoken', text: 42 as unknown as string } as ChannelMessage);
      channel.deliver({ kind: 'spoken', text: null as unknown as string } as ChannelMessage);
      channel.deliver({ kind: 'spoken', text: undefined as unknown as string } as ChannelMessage);
    }).not.toThrow();
    
    expect(backend.calls).toHaveLength(0);
  });
});
