import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventSink, createRoutingSubscriber, consoleDecisionSink } from '../bus.js';
import { createDaemon, resolveStateRootFromEnv } from '../daemon.js';
import { createDecisionLedger } from '../ledger.js';
import { createArchRecapSubscriber } from '../archRecap.js';
import { createArchRecapDeps } from '../archRecapDeps.js';

const SOCKET_NAME = 'daemon.sock';
const PIDFILE_NAME = 'daemon.pid';
const LOG_NAME = 'daemon.log';

async function main(): Promise<void> {
  if (process.argv.includes('--ensure')) {
    try {
      await ensureDaemon();
    } catch {
      // Never fail the agent run from a SessionStart hook.
    }

    process.exit(0);
  }

  await serveDaemon();
}

async function ensureDaemon(): Promise<void> {
  const stateRoot = resolveStateRootFromEnv(process.env);
  const socketPath = join(stateRoot, SOCKET_NAME);

  if (await canConnect(socketPath)) {
    return;
  }

  mkdirSync(stateRoot, { recursive: true });
  const logFd = openSync(join(stateRoot, LOG_NAME), 'a');

  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });

    child.unref();
  } finally {
    closeSync(logFd);
  }
}

async function serveDaemon(): Promise<void> {
  const stateRoot = resolveStateRootFromEnv(process.env);
  const pidfilePath = join(stateRoot, PIDFILE_NAME);
  const ledger = createDecisionLedger();
  const daemon = createDaemon({
    sink: createEventSink([
      createRoutingSubscriber({ sinks: [consoleDecisionSink(), ledger.sink] }),
      createArchRecapSubscriber(createArchRecapDeps(stateRoot)),
    ]),
  });

  try {
    await daemon.start();
  } catch (error) {
    if (isSocketAlreadyInUse(error)) {
      process.exit(0);
    }

    throw error;
  }

  writeFileSync(pidfilePath, String(process.pid));
  process.on('exit', () => {
    try {
      unlinkSync(pidfilePath);
    } catch {
      // Best-effort cleanup on process exit.
    }
  });
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolveCanConnect) => {
    const client = createConnection(socketPath);
    const timeout = setTimeout(() => done(false), 250);

    const done = (result: boolean) => {
      clearTimeout(timeout);
      client.removeAllListeners();
      client.destroy();
      resolveCanConnect(result);
    };

    client.once('connect', () => done(true));
    client.once('error', () => done(false));
  });
}

function isSocketAlreadyInUse(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('socket already in use:');
}

void main().catch(() => {
  process.exit(1);
});
