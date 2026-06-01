import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDaemon } from '../src/daemon.js';
import { connect, createServer } from 'node:net';
import { mkdtemp, rm, access, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

/**
 * Helper to send raw data and wait for a specific number of newline-terminated responses.
 */
async function exchange(socketPath: string, input: string, expectedResponses = 1): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const responses: string[] = [];
    let buffer = '';

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error(`Timed out waiting for ${expectedResponses} responses. Received: ${responses.length}`));
    }, 2000);

    client.on('data', (data) => {
      buffer += data.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        if (part) {
          responses.push(part);
          if (responses.length === expectedResponses) {
            clearTimeout(timeout);
            client.end();
          }
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.on('end', () => {
      clearTimeout(timeout);
      resolve(responses);
    });

    client.write(input);
    // We don't call client.end() here if we expect multiple responses and want to keep the pipe open,
    // but the input should include newlines as per NDJSON.
  });
}

describe('Daemon IPC Contract (0.2a)', () => {
  let tempDir: string;
  let socketPath: string;
  let daemon: any;
  const sink = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-test-'));
    socketPath = join(tempDir, 'daemon.sock');
    sink.mockClear();
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop().catch(() => {});
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Criterion 1 & 5: Lifecycle (start/stop)', () => {
    it('should create socket and set isListening on start, then cleanup on stop', async () => {
      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      
      expect(daemon.isListening).toBe(false);
      await daemon.start();
      
      expect(daemon.isListening).toBe(true);
      expect(daemon.socketPath).toBe(socketPath);
      expect(existsSync(socketPath)).toBe(true);

      await daemon.stop();
      expect(daemon.isListening).toBe(false);
      expect(existsSync(socketPath)).toBe(false);

      // Connect attempt should fail now
      await expect(new Promise((_, reject) => {
        const c = connect(socketPath);
        c.on('error', reject);
      })).rejects.toThrow();
    });
  });

  describe('Criterion 2 & 3: Event Validation and Delivery', () => {
    beforeEach(async () => {
      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      await daemon.start();
    });

    it('should accept a valid RawHookEvent and deliver to sink', async () => {
      const event = {
        v: 1,
        hook: 'TestHook',
        sessionId: 'session-123',
        ts: new Date().toISOString(),
        payload: { key: 'value' }
      };

      const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
      expect(JSON.parse(res)).toEqual({ ok: true });
      
      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink).toHaveBeenCalledWith(event);
    });

    it('should treat absent payload as empty object', async () => {
      const event = {
        v: 1,
        hook: 'NoPayload',
        sessionId: '',
        ts: new Date().toISOString()
      };

      const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
      expect(JSON.parse(res)).toEqual({ ok: true });
      expect(sink).toHaveBeenCalledWith({ ...event, payload: {} });
    });

    it('should reject non-object JSON', async () => {
      const inputs = ['[1,2,3]\n', '123\n', '"string"\n', 'null\n'];
      for (const input of inputs) {
        const [res] = await exchange(socketPath, input);
        const parsed = JSON.parse(res);
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toBeDefined();
      }
      expect(sink).not.toHaveBeenCalled();
    });

    it('should reject invalid schema (v !== 1)', async () => {
      const event = { v: 2, hook: 'Test', ts: '...', sessionId: '' };
      const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
      expect(JSON.parse(res).ok).toBe(false);
      expect(sink).not.toHaveBeenCalled();
    });

    it('should reject missing or empty hook', async () => {
      const events = [
        { v: 1, ts: '...', sessionId: '' }, // missing hook
        { v: 1, hook: '', ts: '...', sessionId: '' }, // empty hook
        { v: 1, hook: 123, ts: '...', sessionId: '' } // non-string hook
      ];
      for (const event of events) {
        const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
        expect(JSON.parse(res).ok).toBe(false);
      }
      expect(sink).not.toHaveBeenCalled();
    });

    it('should reject non-string ts', async () => {
      const event = { v: 1, hook: 'Test', ts: 123, sessionId: '' };
      const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
      expect(JSON.parse(res).ok).toBe(false);
      expect(sink).not.toHaveBeenCalled();
    });

    it('should reject non-object payload', async () => {
      const event = { v: 1, hook: 'Test', ts: '...', sessionId: '', payload: 'not-an-object' };
      const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
      expect(JSON.parse(res).ok).toBe(false);
      expect(sink).not.toHaveBeenCalled();
    });
  });

  describe('Criterion 4: Multi-line connection', () => {
    it('should process multiple lines on one connection in order', async () => {
      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      await daemon.start();

      const events = [
        { v: 1, hook: 'First', ts: '...', sessionId: '' },
        { v: 1, hook: 'Second', ts: '...', sessionId: '' }
      ];
      const input = events.map(e => JSON.stringify(e)).join('\n') + '\n';
      
      const responses = await exchange(socketPath, input, 2);
      expect(responses.length).toBe(2);
      expect(JSON.parse(responses[0])).toEqual({ ok: true });
      expect(JSON.parse(responses[1])).toEqual({ ok: true });

      expect(sink).toHaveBeenCalledTimes(2);
      expect(sink.mock.calls[0][0].hook).toBe('First');
      expect(sink.mock.calls[1][0].hook).toBe('Second');
    });
  });

  describe('Criterion 6 & 7: Stale and Live Socket handling', () => {
    it('should succeed if a stale socket exists (Criterion 6)', async () => {
      // Manually create a "stale" socket (just a file at the path)
      const fakeServer = createServer();
      await new Promise<void>(resolve => fakeServer.listen(socketPath, resolve));
      await new Promise<void>(resolve => fakeServer.close(() => resolve()));
      // Socket file remains but no one is listening

      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      await expect(daemon.start()).resolves.not.toThrow();
      expect(daemon.isListening).toBe(true);
    });

    it('should fail if a live socket exists (Criterion 7)', async () => {
      const existingDaemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      try {
        await existingDaemon.start();

        daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
        await expect(daemon.start()).rejects.toThrow();
      } finally {
        await existingDaemon.stop();
      }
    });
  });

  describe('Criterion 8: Signal handling', () => {
    it('should trigger graceful shutdown on SIGTERM', async () => {
      const processOnSpy = vi.spyOn(process, 'on');
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { return undefined as never; });

      try {
        daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
        await daemon.start();

        // Locate the registered 'SIGTERM' handler from the spy's recorded calls
        const sigtermHandler = processOnSpy.mock.calls.find(call => call[0] === 'SIGTERM')?.[1] as Function;
        
        // The test MUST FAIL if no SIGTERM handler was registered
        expect(sigtermHandler).toBeDefined();
        
        // Invoke the handler and assert graceful shutdown
        await sigtermHandler();
        
        expect(daemon.isListening).toBe(false);
        expect(existsSync(socketPath)).toBe(false);
      } finally {
        processOnSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  describe('Criterion 9: Adversarial input (Gemini remit)', () => {
    beforeEach(async () => {
      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      await daemon.start();
    });

    it('should handle oversized payload', async () => {
      const largePayload = 'a'.repeat(1024 * 1024); // 1MB
      const event = { v: 1, hook: 'Large', ts: '...', sessionId: '', payload: { data: largePayload } };
      const [res] = await exchange(socketPath, JSON.stringify(event) + '\n');
      expect(JSON.parse(res)).toEqual({ ok: true });
      expect(sink).toHaveBeenCalled();
    });

    it('should handle partial line followed by disconnect', async () => {
      const client = connect(socketPath);
      client.write('{"v":1, "hook": "Partial"'); // No newline, incomplete JSON
      await new Promise(r => setTimeout(r, 50));
      client.end();
      
      // Daemon should stay alive
      expect(daemon.isListening).toBe(true);
      expect(sink).not.toHaveBeenCalled();
    });

    it('should handle two lines in one TCP segment', async () => {
      const ev1 = { v: 1, hook: 'One', ts: '...', sessionId: '' };
      const ev2 = { v: 1, hook: 'Two', ts: '...', sessionId: '' };
      const payload = JSON.stringify(ev1) + '\n' + JSON.stringify(ev2) + '\n';
      
      const responses = await exchange(socketPath, payload, 2);
      expect(responses.length).toBe(2);
      expect(sink).toHaveBeenCalledTimes(2);
    });

    it('should handle one line split across two segments', async () => {
      const event = { v: 1, hook: 'Split', ts: '...', sessionId: '' };
      const full = JSON.stringify(event) + '\n';
      const half1 = full.slice(0, 10);
      const half2 = full.slice(10);

      return new Promise<void>((resolve, reject) => {
        const client = connect(socketPath);
        let response = '';
        client.on('data', d => response += d.toString());
        client.on('end', () => {
          try {
            expect(JSON.parse(response)).toEqual({ ok: true });
            expect(sink).toHaveBeenCalledWith({ ...event, payload: {} });
            resolve();
          } catch (e) { reject(e); }
        });

        client.write(half1);
        setTimeout(() => {
          client.write(half2);
          client.end();
        }, 50);
      });
    });

    it('should handle empty connection that closes without sending', async () => {
      const client = connect(socketPath);
      await new Promise(r => client.on('connect', r));
      client.end();
      await new Promise(r => client.on('close', r));
      
      expect(daemon.isListening).toBe(true);
      expect(sink).not.toHaveBeenCalled();
    });

    it('should recover from malformed line and process valid one on same connection', async () => {
      const malformed = 'not json\n';
      const valid = JSON.stringify({ v: 1, hook: 'Valid', ts: '...', sessionId: '' }) + '\n';
      
      const responses = await exchange(socketPath, malformed + valid, 2);
      expect(responses.length).toBe(2);
      expect(JSON.parse(responses[0]).ok).toBe(false);
      expect(JSON.parse(responses[1]).ok).toBe(true);
      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink.mock.calls[0][0].hook).toBe('Valid');
    });
  });

  describe('Criterion 10: Removability', () => {
    it('should only create files within stateRoot and leave nothing behind after deletion', async () => {
      // Use a sub-folder to ensure we don't accidentally check the whole tmpdir
      const stateRoot = join(tempDir, 'state-root');
      const socket = join(stateRoot, 'daemon.sock');
      
      daemon = createDaemon({ stateRoot, socketPath: socket, sink });
      
      // Check logging (optional, hard to verify without intercepting stdout, 
      // but let's assume it should at least start)
      await daemon.start();
      
      const event = { v: 1, hook: 'Test', ts: '...', sessionId: '' };
      await exchange(socket, JSON.stringify(event) + '\n');
      
      await daemon.stop();

      // Check for any Familiar files outside stateRoot. 
      // Since we don't know what "Familiar" files look like, we'll verify
      // that the tempDir (parent of stateRoot) contains ONLY the state-root folder or is empty.
      const filesInParent = await readdir(tempDir);
      // It might have the state-root folder.
      for (const file of filesInParent) {
        if (file !== 'state-root') {
          // If there's something else, it might be a leak.
          // However, some OS artifacts might exist. We'll be strict.
          throw new Error(`Leak detected: ${file} found in ${tempDir}`);
        }
      }

      // Deleting stateRoot should leave nothing Familiar.
      await rm(stateRoot, { recursive: true, force: true });
      const finalFiles = await readdir(tempDir);
      expect(finalFiles).toHaveLength(0);
    });
  });

  describe('Criterion 11: Sink failure isolation', () => {
    it('should ack {ok:true} even if sink throws and continue processing same connection', async () => {
      let throwFirst = true;
      const failingSink = vi.fn((_event) => {
        if (throwFirst) {
          throwFirst = false;
          throw new Error('Sink Error');
        }
      });

      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink: failingSink });
      await daemon.start();

      const event1 = { v: 1, hook: 'FailMe', ts: '...', sessionId: '' };
      const event2 = { v: 1, hook: 'SucceedMe', ts: '...', sessionId: '' };
      const payload = JSON.stringify(event1) + '\n' + JSON.stringify(event2) + '\n';

      const responses = await exchange(socketPath, payload, 2);
      
      expect(responses.length).toBe(2);
      // Per Criterion 11: validated line that the sink throws on still receives {"ok":true}
      expect(JSON.parse(responses[0])).toEqual({ ok: true });
      expect(JSON.parse(responses[1])).toEqual({ ok: true });
      
      expect(failingSink).toHaveBeenCalledTimes(2);
      expect(daemon.isListening).toBe(true);
    });
  });

  describe('Criterion 12: Shutdown with an open connection', () => {
    it('should resolve stop() promptly even if a client connection is open', async () => {
      daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      await daemon.start();

      const client = connect(socketPath);
      await new Promise(r => client.on('connect', r));

      // stop() should resolve even with open client
      const stopPromise = daemon.stop();
      
      // Use a race to enforce "promptly" (500ms is ample)
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('stop() timed out')), 500)
      );
      
      await expect(Promise.race([stopPromise, timeout])).resolves.not.toThrow();

      expect(daemon.isListening).toBe(false);
      expect(existsSync(socketPath)).toBe(false);

      client.destroy();
    });
  });
});
