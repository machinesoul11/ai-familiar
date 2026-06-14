import { describe, it, expect, vi } from 'vitest';
import { createRoutingBackend } from '../src/routingBackend.js';
import type { SpeechBackend } from '../src/ttsChannel.js';
import type { SpeechProvider } from '../src/ttsConfig.js';

describe('routingBackend.ts', () => {
  it('AC10, AC11, AC12: Per-utterance routing, lazy+cached factories, speak return passthrough', async () => {
    const sayBackend: SpeechBackend = {
      speak: vi.fn().mockResolvedValue('say-res'),
      stop: vi.fn()
    };
    const elBackend: SpeechBackend = {
      speak: vi.fn().mockResolvedValue('el-res'),
      stop: vi.fn()
    };

    const sayFactory = vi.fn().mockReturnValue(sayBackend);
    const elFactory = vi.fn().mockReturnValue(elBackend);

    let currentProvider: SpeechProvider = 'say';

    const backend = createRoutingBackend({
      resolveProvider: () => currentProvider,
      backends: {
        say: sayFactory,
        elevenlabs: elFactory
      }
    });

    // Speak 1: say
    const res1 = backend.speak('hello say');
    expect(sayFactory).toHaveBeenCalledTimes(1);
    expect(elFactory).not.toHaveBeenCalled();
    expect(sayBackend.speak).toHaveBeenCalledWith('hello say');
    await expect(res1).resolves.toBe('say-res');

    // Speak 2: elevenlabs
    currentProvider = 'elevenlabs';
    const res2 = backend.speak('hello el');
    expect(elFactory).toHaveBeenCalledTimes(1);
    expect(elBackend.speak).toHaveBeenCalledWith('hello el');
    await expect(res2).resolves.toBe('el-res');

    // Speak 3: say again (cached)
    currentProvider = 'say';
    backend.speak('hello say 2');
    expect(sayFactory).toHaveBeenCalledTimes(1); // not called again
    expect(sayBackend.speak).toHaveBeenCalledWith('hello say 2');
  });

  it('AC13: stop fan-out to cached backends', () => {
    const sayBackend: SpeechBackend = { speak: vi.fn(), stop: vi.fn() };
    const elBackend: SpeechBackend = { speak: vi.fn(), stop: vi.fn() };

    const sayFactory = vi.fn().mockReturnValue(sayBackend);
    const elFactory = vi.fn().mockReturnValue(elBackend);

    let currentProvider: SpeechProvider = 'say';
    const backend = createRoutingBackend({
      resolveProvider: () => currentProvider,
      backends: { say: sayFactory, elevenlabs: elFactory }
    });

    // No-op stop before speak
    expect(() => backend.stop?.()).not.toThrow();
    
    backend.speak('init say');
    backend.stop?.();
    expect(sayBackend.stop).toHaveBeenCalledTimes(1);
    expect(elBackend.stop).not.toHaveBeenCalled();

    currentProvider = 'elevenlabs';
    backend.speak('init el');
    backend.stop?.();
    expect(sayBackend.stop).toHaveBeenCalledTimes(2);
    expect(elBackend.stop).toHaveBeenCalledTimes(1);
  });

  it('AC13: stop ignores backends without stop method', () => {
    const sayBackend: SpeechBackend = { speak: vi.fn() };
    const backend = createRoutingBackend({
      resolveProvider: () => 'say',
      backends: {
        say: () => sayBackend,
        elevenlabs: () => ({ speak: vi.fn() })
      }
    });
    backend.speak('init');
    expect(() => backend.stop?.()).not.toThrow();
  });

  it('AC14: Totality (exceptions do not propagate)', () => {
    const backend = createRoutingBackend({
      resolveProvider: () => 'say',
      backends: {
        say: () => { throw new Error('Factory failed'); },
        elevenlabs: () => ({ speak: () => { throw new Error('Speak failed'); } })
      }
    });

    expect(() => backend.speak('test')).not.toThrow();

    const backend2 = createRoutingBackend({
      resolveProvider: () => 'elevenlabs',
      backends: {
        say: () => ({ speak: vi.fn() }),
        elevenlabs: () => ({ speak: () => { throw new Error('Speak failed'); } })
      }
    });
    
    expect(() => backend2.speak('test')).not.toThrow();
    expect(() => backend2.stop?.()).not.toThrow();
  });
});
