import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { forwardHookEvent, resolveSocketPath } from '../src/bridge.js';
import { createDaemon } from '../src/daemon.js';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawn } from 'node:child_process';

describe('Hook Bridge Contract (0.2b)', () => {
  let tempDir: string;
  let socketPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hook-bridge-test-'));
    socketPath = join(tempDir, 'daemon.sock');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Function Layer', () => {
    let server: Server | undefined;
    let receivedData: Buffer[] = [];
    let connections: Socket[] = [];

    const startStubServer = (handler?: (socket: Socket) => void) => {
      receivedData = [];
      connections = [];
      server = createServer((socket) => {
        connections.push(socket);
        socket.on('data', (chunk) => receivedData.push(chunk));
        if (handler) handler(socket);
      });
      return new Promise<void>((res) => server!.listen(socketPath, res));
    };

    afterEach(async () => {
      if (server) {
        for (const conn of connections) conn.destroy();
        await new Promise((res) => server!.close(res));
        server = undefined;
      }
    });

    // Criterion 1: Happy path - correct envelope and sent status
    it('Criterion 1: should send correct envelope and resolve "sent"', async () => {
      await startStubServer((socket) => socket.on('data', () => socket.end()));
      const now = '2026-06-01T12:00:00.000Z';
      const stdin = JSON.stringify({ session_id: 'sess-1', data: 'foo' });
      
      const result = await forwardHookEvent({
        hook: 'test-hook',
        stdin,
        socketPath,
        now: () => now,
      });

      expect(result).toEqual({ status: 'sent' });
      const line = Buffer.concat(receivedData).toString();
      expect(line.endsWith('\n')).toBe(true);
      const event = JSON.parse(line);
      expect(event).toEqual({
        v: 1,
        hook: 'test-hook',
        sessionId: 'sess-1',
        ts: now,
        payload: { session_id: 'sess-1', data: 'foo' }
      });
    });

    // Criterion 2: Cross-contract validity - accepted by real daemon
    it('Criterion 2: should be accepted by real 0.2a daemon', async () => {
      const sink = vi.fn();
      const daemon = createDaemon({ stateRoot: tempDir, socketPath, sink });
      await daemon.start();

      try {
        const result = await forwardHookEvent({
          hook: 'integration-hook',
          stdin: '{"session_id":"s2","val":42}',
          socketPath,
          now: () => new Date().toISOString(),
        });

        expect(result).toEqual({ status: 'sent' });
        // Give daemon a moment to process
        await new Promise(r => setTimeout(r, 100));
        expect(sink).toHaveBeenCalledTimes(1);
        const delivered = sink.mock.calls[0][0];
        expect(delivered.hook).toBe('integration-hook');
        expect(delivered.sessionId).toBe('s2');
        expect(delivered.payload).toEqual({ session_id: 's2', val: 42 });
      } finally {
        await daemon.stop();
      }
    });

    // Criterion 3: Garbage/empty stdin defaults payload to {}
    it('Criterion 3: should handle garbage/empty stdin by defaulting payload to {}', async () => {
      await startStubServer((socket) => socket.on('data', () => socket.end()));
      const inputs = ['', '   ', 'not json', '[1,2]', 'null', '123'];
      
      for (const stdin of inputs) {
        receivedData = [];
        await forwardHookEvent({
          hook: 'garbage-hook',
          stdin,
          socketPath,
          now: () => 'ts',
        });
        const event = JSON.parse(Buffer.concat(receivedData).toString());
        expect(event.payload).toEqual({});
      }
    });

    // Criterion 4: sessionId fallback to ""
    it('Criterion 4: should fallback sessionId to "" if session_id is missing or non-string', async () => {
      await startStubServer((socket) => socket.on('data', () => socket.end()));
      const inputs = [
        '{}',
        '{"session_id": 123}',
        '{"session_id": null}',
        '{"other": "stuff"}'
      ];

      for (const stdin of inputs) {
        receivedData = [];
        await forwardHookEvent({
          hook: 'sess-hook',
          stdin,
          socketPath,
          now: () => 'ts',
        });
        const event = JSON.parse(Buffer.concat(receivedData).toString());
        expect(event.sessionId).toBe("");
      }
    });

    // Criterion 5: Daemon down - unreachable
    it('Criterion 5: should resolve "daemon-unreachable" if socket does not exist', async () => {
      const result = await forwardHookEvent({
        hook: 'down-hook',
        stdin: '{}',
        socketPath: join(tempDir, 'no-such-socket.sock'),
        now: () => 'ts',
      });
      expect(result).toEqual({ status: 'dropped', reason: 'daemon-unreachable' });
    });

    // Criterion 6: Daemon stalls - timeout
    it('Criterion 6: should resolve "send-timeout" if daemon accepts but stalls', async () => {
      receivedData = [];
      connections = [];
      server = createServer({ allowHalfOpen: true }, (socket) => {
        connections.push(socket);
        socket.on('data', () => {});
      });
      await new Promise<void>((res) => server!.listen(socketPath, res));

      const start = Date.now();
      const timeoutMs = 200;
      const result = await forwardHookEvent({
        hook: 'stall-hook',
        stdin: '{}',
        socketPath,
        now: () => 'ts',
        timeoutMs,
      });
      const duration = Date.now() - start;
      expect(result).toEqual({ status: 'dropped', reason: 'send-timeout' });
      expect(duration).toBeGreaterThanOrEqual(timeoutMs);
      expect(duration).toBeLessThan(timeoutMs + 400); // Allow reasonable slack
    });

    // Criterion 7: Mid-write error - send-error
    it('Criterion 7: should resolve "send-error" if socket error occurs mid-write', async () => {
      receivedData = [];
      connections = [];
      server = createServer((socket) => {
        connections.push(socket);
        socket.on('error', () => {});
        socket.destroy();
      });
      server.on('error', () => {});
      await new Promise<void>((res) => server!.listen(socketPath, res));

      const result = await forwardHookEvent({
        hook: 'error-hook',
        stdin: '{}',
        socketPath,
        now: () => 'ts',
      });
      expect(result).toEqual({ status: 'dropped', reason: 'send-error' });
    });

    // Criterion 8: Never rejects
    it('Criterion 8: forwardHookEvent should never reject', async () => {
      // Even with missing options, it should handle gracefully or resolve
      await expect(forwardHookEvent({
        hook: 'any',
        stdin: undefined as any,
        socketPath: undefined as any,
        now: () => 'ts'
      })).resolves.toBeDefined();
    });

    // Criterion 13: Single line, clean close
    it('Criterion 13: should write exactly one newline and escape internal ones', async () => {
      await startStubServer((socket) => socket.on('data', () => socket.end()));
      const stdin = JSON.stringify({ multi: "line\nstring\r" });
      await forwardHookEvent({
        hook: 'newline-hook',
        stdin,
        socketPath,
        now: () => 'ts',
      });
      
      const raw = Buffer.concat(receivedData).toString();
      const lines = raw.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe('');
      expect(raw.match(/\n/g)).toHaveLength(1);
    });

    it('Adversarial: 1MB payload', async () => {
      await startStubServer((socket) => {
        socket.on('end', () => socket.end());
      });
      const large = 'a'.repeat(1024 * 1024);
      const result = await forwardHookEvent({
        hook: 'large',
        stdin: JSON.stringify({ data: large }),
        socketPath,
        now: () => 'ts',
      });
      expect(result).toEqual({ status: 'sent' });
      const event = JSON.parse(Buffer.concat(receivedData).toString());
      expect(event.payload.data).toBe(large);
    });

    it('Adversarial: concurrent invocations against one stub', async () => {
      await startStubServer((socket) => {
        setTimeout(() => socket.end(), 50);
      });
      const results = await Promise.all([
        forwardHookEvent({ hook: 'h1', stdin: '{}', socketPath, now: () => 't1' }),
        forwardHookEvent({ hook: 'h2', stdin: '{}', socketPath, now: () => 't2' })
      ]);
      expect(results[0].status).toBe('sent');
      expect(results[1].status).toBe('sent');
      const lines = Buffer.concat(receivedData).toString().trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('Subprocess Layer', () => {
    const binPath = resolve('src/bin/familiar-hook.ts');

    const runCli = (hookName: string | undefined, stdin: string, env: Record<string, string> = {}) => {
      return new Promise<{ code: number | null, stdout: string, stderr: string }>((res) => {
        const args = hookName ? [hookName] : [];
        const child = spawn('node', ['--import', 'tsx', binPath, ...args], {
          env: { ...process.env, FAMILIAR_HOME: tempDir, ...env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => stdout += d.toString());
        child.stderr.on('data', (d) => stderr += d.toString());
        
        child.on('close', (code) => res({ code, stdout, stderr }));

        child.stdin.write(stdin);
        child.stdin.end();
      });
    };

    // Criterion 9 & 10: CLI always exits 0 and silent stdout
    it('Criterion 9 & 10: CLI should always exit 0 and write nothing to stdout', async () => {
      // 1. Live daemon
      const daemon = createDaemon({ stateRoot: tempDir });
      await daemon.start();
      try {
        const res = await runCli('happy', '{}');
        expect(res.code).toBe(0);
        expect(res.stdout).toBe('');
      } finally {
        await daemon.stop();
      }

      // 2. Missing daemon
      const res2 = await runCli('no-daemon', '{}');
      expect(res2.code).toBe(0);
      expect(res2.stdout).toBe('');

      // 3. Stalled daemon
      const server = createServer();
      await new Promise<void>(r => server.listen(socketPath, r));
      const res3 = await runCli('stalled', '{}');
      expect(res3.code).toBe(0);
      expect(res3.stdout).toBe('');
      server.close();

      // 4. Garbage stdin
      const res4 = await runCli('garbage', 'not json');
      expect(res4.code).toBe(0);
      expect(res4.stdout).toBe('');
    });

    // Criterion 11: Hook-name precedence
    it('Criterion 11: should honor hook precedence argv -> stdin.hook_event_name -> "Unknown"', async () => {
      const received: any[] = [];
      const daemon = createDaemon({ stateRoot: tempDir, sink: (e) => received.push(e) });
      await daemon.start();

      try {
        // 1. From argv (highest precedence)
        await runCli('from-argv', '{"hook_event_name": "from-stdin"}');
        expect(received[received.length - 1].hook).toBe('from-argv');

        // 2. From stdin.hook_event_name (argv omitted)
        await runCli(undefined, '{"hook_event_name": "from-stdin"}');
        expect(received[received.length - 1].hook).toBe('from-stdin');

        // 3. Unknown (both missing)
        await runCli(undefined, '{}');
        expect(received[received.length - 1].hook).toBe('Unknown');
      } finally {
        await daemon.stop();
      }
    });

    // Criterion 12: Socket resolution parity (subprocess check)
    it('Criterion 12: CLI should connect to FAMILIAR_HOME/daemon.sock', async () => {
      const customHome = join(tempDir, 'custom-home');
      const expectedSocket = join(customHome, 'daemon.sock');
      await mkdir(customHome, { recursive: true });
      
      let connected = false;
      const server = createServer((socket) => {
        connected = true;
        socket.end();
      });
      await new Promise<void>(r => server.listen(expectedSocket, r));

      try {
        await runCli('test', '{}', { FAMILIAR_HOME: customHome });
        expect(connected).toBe(true);
      } finally {
        server.close();
      }
    });
  });

  describe('resolveSocketPath', () => {
    // Criterion 12: resolveSocketPath parity
    it('Criterion 12: resolveSocketPath should honor FAMILIAR_HOME and default to ~/.familiar', () => {
      expect(resolveSocketPath({ FAMILIAR_HOME: '/tmp/foo' })).toBe(resolve('/tmp/foo/daemon.sock'));
      const home = homedir();
      expect(resolveSocketPath({})).toBe(resolve(join(home, '.familiar', 'daemon.sock')));
    });
  });

  // Criterion 14: Removability preserved
  it('Criterion 14: should not create any files on disk', async () => {
    const listFiles = async (dir: string) => {
      const { readdir } = await import('node:fs/promises');
      try { return await readdir(dir); } catch { return []; }
    };

    // Use a clean subdirectory
    const cleanDir = join(tempDir, 'removability-check');
    await mkdir(cleanDir);
    const before = await listFiles(cleanDir);

    await forwardHookEvent({
      hook: 'removability',
      stdin: '{}',
      socketPath: join(cleanDir, 'no-daemon.sock'),
      now: () => 'ts'
    });

    const after = await listFiles(cleanDir);
    expect(after).toEqual(before);
  });
});
