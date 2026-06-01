import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, createConnection, type Socket, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

describe('Plugin Manifest & Hook Wiring (0.2c)', () => {
  let tempHome: string;

  beforeAll(() => {
    // Criterion 3: Ensure build exists
    try {
      execSync('npm run build', { cwd: repoRoot, stdio: 'ignore' });
    } catch (e) {
      // Expected to fail during Red phase if build script is missing
    }
  });

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'familiar-test-home-'));
  });

  afterEach(async () => {
    // Cleanup detached daemon if running
    const pidPath = join(tempHome, 'daemon.pid');
    if (existsSync(pidPath)) {
      try {
        const pid = parseInt(readFileSync(pidPath, 'utf8'), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 'SIGTERM');
          // Wait briefly for cleanup
          for (let i = 0; i < 10; i++) {
            if (!existsSync(pidPath)) break;
            await new Promise(r => setTimeout(r, 50));
          }
        }
      } catch {
        // Ignore if already dead
      }
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  const substitute = (cmd: string) => cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, repoRoot);
  const cmdFor = (config: any, event: string) => config.hooks[event][0].hooks[0].command;

  // Criterion 1: Manifest valid
  it('Criterion 1: .claude-plugin/plugin.json parses and has a non-empty name', () => {
    const manifestPath = join(repoRoot, '.claude-plugin', 'plugin.json');
    expect(existsSync(manifestPath), 'plugin.json should exist').toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.name).toBeDefined();
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  // Criterion 2: Hooks declared
  it('Criterion 2: hooks/hooks.json declares exactly the five required events', () => {
    const hooksPath = join(repoRoot, 'hooks', 'hooks.json');
    expect(existsSync(hooksPath), 'hooks.json should exist').toBe(true);
    const config = JSON.parse(readFileSync(hooksPath, 'utf8'));
    const events = config.hooks;
    
    const requiredEvents = ['SessionStart', 'Stop', 'SubagentStop', 'Notification', 'SessionEnd'];
    expect(Object.keys(events)).toHaveLength(requiredEvents.length);
    
    for (const event of requiredEvents) {
      const group = events[event];
      expect(group, `Missing hook: ${event}`).toBeDefined();
      expect(Array.isArray(group)).toBe(true);
      expect(group[0].matcher).toBe('');
      expect(group[0].hooks[0].type).toBe('command');
      expect(typeof group[0].hooks[0].command).toBe('string');
      
      const cmd = group[0].hooks[0].command;
      expect(cmd).toContain('${CLAUDE_PLUGIN_ROOT}');
      
      if (event !== 'SessionStart') {
        expect(cmd).toContain('familiar-hook.js');
        expect(cmd.endsWith(` ${event}`)).toBe(true);
      } else {
        expect(cmd).toContain('familiar-daemon.js');
        expect(cmd).toContain('--ensure');
      }
    }
  });

  // Criterion 3: Build produces runnable bins
  it('Criterion 3: dist/bin/*.js exist and are reachable', async () => {
    const hookBin = join(repoRoot, 'dist', 'bin', 'familiar-hook.js');
    const daemonBin = join(repoRoot, 'dist', 'bin', 'familiar-daemon.js');
    
    expect(existsSync(hookBin), 'familiar-hook.js should exist').toBe(true);
    expect(existsSync(daemonBin), 'familiar-daemon.js should exist').toBe(true);
    
    // Verify hooks.json paths resolve to these
    const config = JSON.parse(readFileSync(join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
    expect(substitute(cmdFor(config, 'Stop'))).toContain(hookBin);
    expect(substitute(cmdFor(config, 'SessionStart'))).toContain(daemonBin);
  });

  // Criterion 4 & 5: Forward end-to-end
  describe('Forwarding Hooks (Criteria 4 & 5)', () => {
    const runHook = (cmd: string, payload: string, env: any) => new Promise<{ code: number | null, stdout: string }>((resolve) => {
      let stdout = '';
      const child = spawn('sh', ['-c', cmd], { env, stdio: ['pipe','pipe','pipe'] });
      child.stdout.on('data', d => stdout += d.toString());
      child.on('close', (code) => resolve({ code, stdout }));
      child.stdin.write(payload);
      child.stdin.end();
    });

    const events = [
      { name: 'Stop', payload: { session_id: 's1', stop_hook_active: true } },
      { name: 'SubagentStop', payload: { session_id: 's2', agent_type: 'coder' } },
      { name: 'Notification', payload: { session_id: 's3', notification_type: 'info' } },
      { name: 'SessionEnd', payload: { session_id: 's4', reason: 'finished' } }
    ];

    for (const { name, payload } of events) {
      it(`Criterion 4 & 5: ${name} forwards to daemon, drops if down`, async () => {
        const fullPayload = {
          ...payload,
          cwd: '/tmp',
          transcript_path: '/tmp/t.md',
          hook_event_name: name,
          permission_mode: 'auto'
        };
        const config = JSON.parse(readFileSync(join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
        const cmd = substitute(cmdFor(config, name));
        const socketPath = join(tempHome, 'daemon.sock');

        // 1. Daemon Up
        let received: any = null;
        const server = createServer((socket) => {
          socket.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
              if (line.trim()) {
                received = JSON.parse(line);
                socket.write(JSON.stringify({ ok: true }) + '\n');
              }
            }
          });
        });
        await new Promise<void>(res => server.listen(socketPath, res));

        try {
          const result = await runHook(cmd, JSON.stringify(fullPayload), { ...process.env, FAMILIAR_HOME: tempHome });
          expect(result.code).toBe(0);
          expect(result.stdout).toBe('');
          
          // Give the stub a moment if needed
          for (let i = 0; i < 10 && !received; i++) {
            await new Promise(r => setTimeout(r, 20));
          }

          expect(received).not.toBeNull();
          expect(received.v).toBe(1);
          expect(received.hook).toBe(name);
          expect(received.sessionId).toBe(fullPayload.session_id);
          expect(typeof received.ts).toBe('string');
          expect(received.payload).toEqual(fullPayload);
        } finally {
          server.close();
          await rm(socketPath, { force: true });
        }

        // 2. Daemon Down
        const resultDown = await runHook(cmd, JSON.stringify(fullPayload), { ...process.env, FAMILIAR_HOME: tempHome });
        expect(resultDown.code).toBe(0);
        expect(resultDown.stdout).toBe('');
      });
    }
  });

  // Criterion 6, 7, 8: Launch behavior
  describe('Daemon Launch (Criteria 6, 7, 8)', () => {
    it('Criterion 6, 7, 8: SessionStart launches detached, idempotent, non-blocking', async () => {
      const config = JSON.parse(readFileSync(join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
      const cmd = substitute(cmdFor(config, 'SessionStart'));
      const socketPath = join(tempHome, 'daemon.sock');
      const logPath = join(tempHome, 'daemon.log');

      // 1. Launch first time
      const start = Date.now();
      const out = execSync(`sh -c '${cmd}'`, {
        env: { ...process.env, FAMILIAR_HOME: tempHome },
        encoding: 'utf8'
      });
      const duration = Date.now() - start;
      expect(out).toBe('');
      expect(duration).toBeLessThan(3000);

      // Verify socket becomes live (Wait a bit for detachment to bind)
      let live = false;
      for (let i = 0; i < 20; i++) {
        if (existsSync(socketPath)) {
          live = await new Promise(res => {
            const conn = createConnection(socketPath);
            conn.on('connect', () => { conn.destroy(); res(true); });
            conn.on('error', () => { conn.destroy(); res(false); });
          });
          if (live) break;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      expect(live, 'Daemon should be live after SessionStart').toBe(true);

      // Criterion 7: Idempotent - run again
      const out2 = execSync(`sh -c '${cmd}'`, {
        env: { ...process.env, FAMILIAR_HOME: tempHome },
        encoding: 'utf8'
      });
      expect(out2).toBe('');
      
      // Check log for EXACTLY ONE start line
      const log = readFileSync(logPath, 'utf8');
      const startLines = log.split('\n').filter(l => {
        try {
          const p = JSON.parse(l);
          return p.daemon === 'familiar' && p.stateRoot;
        } catch { return false; }
      });
      expect(startLines).toHaveLength(1);

      // Criterion 8: Detached - daemon still live after launcher exits
      // (Already verified by checking live AFTER execSync finished)
      const conn = createConnection(socketPath);
      const stillLive = await new Promise(res => {
        conn.on('connect', () => { conn.destroy(); res(true); });
        conn.on('error', () => { conn.destroy(); res(false); });
      });
      expect(stillLive).toBe(true);
    });
  });

  // Criterion 9: Daemon Entrypoint (Serve mode)
  it('Criterion 9: familiar-daemon serve mode lifecycle', async () => {
    const waitFor = async (pred: () => boolean, ms = 2000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (pred()) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      return pred();
    };

    const daemonBin = join(repoRoot, 'dist', 'bin', 'familiar-daemon.js');
    const socketPath = join(tempHome, 'daemon.sock');
    const pidPath = join(tempHome, 'daemon.pid');

    const daemonProc = spawn('node', [daemonBin], {
      env: { ...process.env, FAMILIAR_HOME: tempHome },
      stdio: 'pipe'
    });

    try {
      // Wait for start
      await new Promise<void>((res, rej) => {
        const timeout = setTimeout(() => rej(new Error('Daemon failed to start')), 2000);
        daemonProc.stdout.on('data', (d) => {
          if (d.toString().includes('"daemon":"familiar"')) {
            clearTimeout(timeout);
            res();
          }
        });
      });

      expect(await waitFor(() => existsSync(socketPath) && existsSync(pidPath))).toBe(true);

      // Start second instance - should exit 0 without stealing
      const secondOut = execSync(`node ${daemonBin}`, {
        env: { ...process.env, FAMILIAR_HOME: tempHome },
        encoding: 'utf8'
      });
      expect(secondOut).toBe('');
      expect(existsSync(socketPath)).toBe(true);

      // SIGTERM should cleanup
      daemonProc.kill('SIGTERM');
      await new Promise(res => daemonProc.on('close', res));
      
      expect(await waitFor(() => !existsSync(socketPath) && !existsSync(pidPath))).toBe(true);
    } finally {
      daemonProc.kill('SIGKILL');
    }
  });

  // Criterion 10: Removability
  it('Criterion 10: Runtime files exist ONLY under FAMILIAR_HOME', async () => {
    const config = JSON.parse(readFileSync(join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
    const startCmd = substitute(cmdFor(config, 'SessionStart'));
    const stopCmd = substitute(cmdFor(config, 'Stop'));

    // Launch
    execSync(`sh -c '${startCmd}'`, { env: { ...process.env, FAMILIAR_HOME: tempHome } });
    
    // Wait for live
    for (let i = 0; i < 20; i++) {
      if (existsSync(join(tempHome, 'daemon.sock'))) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Forward
    execSync(`sh -c '${stopCmd}'`, { 
      input: JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      env: { ...process.env, FAMILIAR_HOME: tempHome } 
    });

    // Kill
    const pid = parseInt(readFileSync(join(tempHome, 'daemon.pid'), 'utf8'), 10);
    process.kill(pid, 'SIGTERM');
    
    // Wait for cleanup
    for (let i = 0; i < 20; i++) {
      if (!existsSync(join(tempHome, 'daemon.pid'))) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Verify files
    const files = await readFileList(tempHome);
    // Should have daemon.log, maybe daemon.pid and daemon.sock if they weren't removed yet, but strictly within tempHome
    expect(files.every(f => f.startsWith(tempHome))).toBe(true);
    
    // Check some common "bad" places
    const badPlaces = [
      join(repoRoot, 'daemon.sock'),
      join(repoRoot, 'daemon.pid'),
      join(repoRoot, 'daemon.log'),
      join(process.env.HOME || '', '.familiar-daemon.sock')
    ];
    for (const p of badPlaces) {
      expect(existsSync(p), `Leaked file at ${p}`).toBe(false);
    }
  });

  it('Criterion 5/6: --ensure exits 0 even when FAMILIAR_HOME is unwritable', async () => {
    const badParent = join(tempHome, 'not-a-dir');
    writeFileSync(badParent, 'x');
    const badHome = join(badParent, 'sub');

    const config = JSON.parse(readFileSync(join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
    const cmd = substitute(cmdFor(config, 'SessionStart'));

    const result = await new Promise<{ code: number | null, stdout: string }>((resolve) => {
      let stdout = '';
      const child = spawn('sh', ['-c', cmd], {
        env: { ...process.env, FAMILIAR_HOME: badHome },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdout.on('data', d => stdout += d.toString());
      child.on('close', (code) => resolve({ code, stdout }));
      child.stdin.write(JSON.stringify({ hook_event_name: 'SessionStart' }));
      child.stdin.end();
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  // Criterion 11: [manual] Loads in Claude Code (comment only)
});

async function readFileList(dir: string): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises');
  let results: string[] = [];
  const list = await readdir(dir);
  for (const file of list) {
    const path = join(dir, file);
    const s = await stat(path);
    if (s.isDirectory()) {
      results = results.concat(await readFileList(path));
    } else {
      results.push(path);
    }
  }
  return results;
}
