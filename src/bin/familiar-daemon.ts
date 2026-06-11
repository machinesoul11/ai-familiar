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
import { createDelivery } from '../delivery.js';
import { writeSnapshotFile } from '../recapSnapshotStore.js';
import { createAvatarPublishSocket } from '../avatarPublishSocket.js';
import { createAvatarBackend } from '../avatarBackend.js';
import { createAvatarChannel } from '../avatarChannel.js';
import { createAvatarSubscriber } from '../avatarSubscriber.js';

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
  for (const p of [join(process.cwd(), '.env'), join(stateRoot, '.env')]) {
    try {
      process.loadEnvFile(p);
    } catch {
      // Missing or unreadable env files are ignored.
    }
  }

  const pidfilePath = join(stateRoot, PIDFILE_NAME);
  const ledger = createDecisionLedger();
  const delivery = createDelivery();

  // Avatar lane (4.2c): an ungated, always-on projection of the event stream onto Haru.
  // The publish socket broadcasts NDJSON AvatarCommand frames on <stateRoot>/avatar.sock;
  // a connected overlay (4.2b) renders them. pub.sink exists at construction, so the channel
  // is safe to build (and deliver to) before pub.start() — pre-start writes fan out to zero
  // subscribers, a harmless no-op.
  const avatarPublish = createAvatarPublishSocket();
  const avatarChannel = createAvatarChannel(createAvatarBackend(avatarPublish.sink));

  const daemon = createDaemon({
    sink: createEventSink([
      createRoutingSubscriber({ sinks: [consoleDecisionSink(), ledger.sink, delivery.decisionSink] }),
      createAvatarSubscriber(avatarChannel),
      createArchRecapSubscriber({
        ...createArchRecapDeps(stateRoot),
        onRecap: (summary, finalMessage) => {
          try {
            writeSnapshotFile(stateRoot, { v: 1, summary, finalMessage });
          } catch {
            // A snapshot-write failure must never mute the live spoken recap.
          }

          delivery.deliverRecap(summary, finalMessage);
        },
      }),
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

  // Start the avatar publish socket. A failed avatar socket must NEVER stop the daemon from
  // serving events — degrade to an unconnected channel (writes fan out to zero subscribers).
  try {
    await avatarPublish.start();
  } catch {
    // Avatar overlay is optional; the daemon keeps running without it.
  }

  // Coordinate the avatar socket's shutdown with termination. The daemon's own LocalDaemon
  // registers SIGTERM/SIGINT -> stop() -> process.exit(0); daemon.ts is frozen, so the entrypoint
  // closes the avatar socket separately, best-effort. On a hard kill where process.exit wins the
  // race, a leftover avatar.sock self-heals on next start (4.2a removeStaleSocketOrFail).
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void avatarPublish.stop().catch(() => {
        // Best-effort: a failed close still leaves a self-healing stale socket.
      });
    });
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
