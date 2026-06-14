import { describe, it, expect, vi } from 'vitest';
import { createSerializedBackend } from '../src/serializedBackend.js';

interface SpeechBackend {
  speak(text: string): void | Promise<void>;
  stop?(): void;
}

function defer() {
  let resolve!: () => void;
  let reject!: (err: any) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  // Await a few microtasks to ensure async queue processing stabilizes
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

type SpeakBehavior =
  | { type: 'promise'; deferred: ReturnType<typeof defer> }
  | { type: 'void' }
  | { type: 'sync-throw'; error: Error }
  | { type: 'reject'; error: Error };

class FakeSpeechBackend implements SpeechBackend {
  calls: string[] = [];
  behaviors: Record<string, SpeakBehavior> = {};
  stop = vi.fn();

  speak(text: string): void | Promise<void> {
    this.calls.push(text);
    const behavior = this.behaviors[text];
    
    if (!behavior) {
      return Promise.resolve(); // Default
    }
    if (behavior.type === 'promise') {
      return behavior.deferred.promise;
    }
    if (behavior.type === 'void') {
      return undefined;
    }
    if (behavior.type === 'sync-throw') {
      throw behavior.error;
    }
    if (behavior.type === 'reject') {
      return Promise.reject(behavior.error);
    }
  }
}

describe('createSerializedBackend', () => {
  it('criteria 1 & 2: serializes with at most one inner.speak in flight, preserving FIFO order across >=3 items', async () => {
    const fake = new FakeSpeechBackend();
    const serialized = createSerializedBackend(fake);

    const d1 = defer();
    const d2 = defer();
    const d3 = defer();

    fake.behaviors['A'] = { type: 'promise', deferred: d1 };
    fake.behaviors['B'] = { type: 'promise', deferred: d2 };
    fake.behaviors['C'] = { type: 'promise', deferred: d3 };

    serialized.speak('A');
    serialized.speak('B');
    serialized.speak('C');

    await flush();

    // Only 'A' should have been invoked so far, 'B' and 'C' wait for 'A' to settle.
    expect(fake.calls).toEqual(['A']);

    // Resolve 'A'
    d1.resolve();
    await flush();

    // Now 'B' is triggered.
    expect(fake.calls).toEqual(['A', 'B']);

    // Resolve 'B'
    d2.resolve();
    await flush();

    // Now 'C' is triggered.
    expect(fake.calls).toEqual(['A', 'B', 'C']);

    // Resolve 'C' to clean up
    d3.resolve();
    await flush();
    expect(fake.calls).toEqual(['A', 'B', 'C']);
  });

  it('criteria 3: a rejecting inner promise still advances the queue (no deadlock)', async () => {
    const fake = new FakeSpeechBackend();
    const serialized = createSerializedBackend(fake);

    const d2 = defer();
    fake.behaviors['FailPromise'] = { type: 'reject', error: new Error('Network error') };
    fake.behaviors['Next'] = { type: 'promise', deferred: d2 };

    serialized.speak('FailPromise');
    serialized.speak('Next');

    await flush();

    // 'FailPromise' rejects, but the queue must swallow it and pump 'Next'
    expect(fake.calls).toEqual(['FailPromise', 'Next']);

    d2.resolve();
    await flush();
  });

  it('criteria 4: a synchronously-throwing inner.speak still advances the queue (no deadlock)', async () => {
    const fake = new FakeSpeechBackend();
    const serialized = createSerializedBackend(fake);

    const d2 = defer();
    fake.behaviors['SyncThrow'] = { type: 'sync-throw', error: new Error('Crash') };
    fake.behaviors['Next'] = { type: 'promise', deferred: d2 };

    serialized.speak('SyncThrow');
    serialized.speak('Next');

    await flush();

    // 'SyncThrow' throws synchronously inside the pump, but the queue must swallow and pump 'Next'
    expect(fake.calls).toEqual(['SyncThrow', 'Next']);

    d2.resolve();
    await flush();
  });

  it('criteria 5: a void-returning inner serializes correctly and preserves order', async () => {
    const fake = new FakeSpeechBackend();
    const serialized = createSerializedBackend(fake);

    fake.behaviors['A'] = { type: 'void' };
    fake.behaviors['B'] = { type: 'void' };
    fake.behaviors['C'] = { type: 'void' };

    serialized.speak('A');
    serialized.speak('B');
    serialized.speak('C');

    await flush();

    // All should be processed in order and synchronously or near-synchronously
    expect(fake.calls).toEqual(['A', 'B', 'C']);
  });

  it('criteria 6: speak() returns undefined, never throws, and fresh enqueues after drain work', async () => {
    const fake = new FakeSpeechBackend();
    const serialized = createSerializedBackend(fake);

    // Testing return signature and non-throwing
    fake.behaviors['SyncThrow'] = { type: 'sync-throw', error: new Error('Immediate') };
    
    expect(() => {
      const res = serialized.speak('SyncThrow');
      expect(res).toBeUndefined();
    }).not.toThrow();

    await flush();
    expect(fake.calls).toEqual(['SyncThrow']); // Queue drained

    // Wait a moment longer for empty drain
    await flush();

    // Enqueue after full drain
    const dNew = defer();
    fake.behaviors['Fresh'] = { type: 'promise', deferred: dNew };

    const res2 = serialized.speak('Fresh');
    expect(res2).toBeUndefined();

    await flush();
    expect(fake.calls).toEqual(['SyncThrow', 'Fresh']);

    dNew.resolve();
    await flush();
  });

  describe('stop()', () => {
    it('AC-1: FLUSH PENDING: flushes all pending queued items', async () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake);

      const d1 = defer();
      fake.behaviors['A'] = { type: 'promise', deferred: d1 };

      serialized.speak('A');
      serialized.speak('B');
      serialized.speak('C');

      await flush();
      // 'A' is in flight
      expect(fake.calls).toEqual(['A']);

      serialized.stop();
      
      // Resolve 'A' and wait for pump to check queue
      d1.resolve();
      await flush();

      // 'B' and 'C' should NEVER be called
      expect(fake.calls).toEqual(['A']);
    });

    it('AC-2: DELEGATES TO inner.stop ONCE', () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake);

      serialized.stop();
      expect(fake.stop).toHaveBeenCalledTimes(1);
    });

    it('AC-3: NO-STOP INNER IS SAFE: does not throw if inner has no stop method', () => {
      const fake = {
        speak: vi.fn()
      };
      const serialized = createSerializedBackend(fake as any);

      expect(() => serialized.stop()).not.toThrow();
    });

    it('AC-4: IDLE STOP IS SAFE: can be called anytime', async () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake);

      // Before any speak
      expect(() => serialized.stop()).not.toThrow();
      expect(fake.stop).toHaveBeenCalledTimes(1);

      // After all speech settles
      serialized.speak('A');
      await flush();
      expect(() => serialized.stop()).not.toThrow();
      expect(fake.stop).toHaveBeenCalledTimes(2);
    });

    it('AC-5: RESUMES AFTER STOP: restarting pump normally', async () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake);

      const d1 = defer();
      fake.behaviors['A'] = { type: 'promise', deferred: d1 };

      serialized.speak('A');
      serialized.speak('B');
      await flush();

      serialized.stop();
      d1.resolve();
      await flush();

      expect(fake.calls).toEqual(['A']);

      // New speak after stop
      serialized.speak('D');
      await flush();
      expect(fake.calls).toEqual(['A', 'D']);
    });

    it('AC-6: NEVER THROWS ON inner.stop THROW', () => {
      const fake = new FakeSpeechBackend();
      fake.stop.mockImplementation(() => {
        throw new Error('Inner Stop Failed');
      });
      const serialized = createSerializedBackend(fake);

      expect(() => serialized.stop()).not.toThrow();
      expect(fake.stop).toHaveBeenCalledTimes(1);
    });

    it('AC-7: RETURN TYPES: returns undefined', () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake);

      expect(serialized.speak('x')).toBeUndefined();
      expect(serialized.stop()).toBeUndefined();
    });
  });

  describe('isSpeaking()', () => {
    it('AC-7: returns false before any speak()', () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake) as any;
      expect(serialized.isSpeaking()).toBe(false);
      expect(typeof serialized.isSpeaking()).toBe('boolean'); // AC-12
    });

    it('AC-8 & AC-9 & AC-10: returns true while items are in flight or queued, false when done', async () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake) as any;

      const d1 = defer();
      fake.behaviors['A'] = { type: 'promise', deferred: d1 };

      serialized.speak('A');
      await flush();
      
      // AC-8
      expect(serialized.isSpeaking()).toBe(true);

      serialized.speak('B');
      serialized.speak('C');
      await flush();

      // AC-9
      expect(serialized.isSpeaking()).toBe(true);

      d1.resolve();
      await flush(); // A resolves, B starts (default resolved), C starts (default resolved)
      await flush(); // Need enough flushes for queue to empty

      // AC-10
      expect(serialized.isSpeaking()).toBe(false);
    });

    it('AC-11: returns false after stop() AND in-flight resolves', async () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake) as any;

      const d1 = defer();
      fake.behaviors['A'] = { type: 'promise', deferred: d1 };

      serialized.speak('A');
      await flush();

      expect(serialized.isSpeaking()).toBe(true);

      serialized.stop(); // Flushes queue
      
      d1.resolve();
      await flush();

      expect(serialized.isSpeaking()).toBe(false);
    });

    it('AC-12: returns a boolean and does not throw', () => {
      const fake = new FakeSpeechBackend();
      const serialized = createSerializedBackend(fake) as any;
      
      expect(() => serialized.isSpeaking()).not.toThrow();
      expect(typeof serialized.isSpeaking()).toBe('boolean');
    });
  });
});
