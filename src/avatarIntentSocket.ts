import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseIntent, type AvatarIntent } from './avatarIntent.js';
import { resolveStateRootFromEnv } from './daemon.js';

export interface AvatarIntentSocket {
  readonly socketPath: string;
  readonly isListening: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type AvatarIntentSocketOptions = {
  stateRoot?: string;
  socketPath?: string;
  onIntent: (intent: AvatarIntent) => void;
};

const DEFAULT_SOCKET_NAME = 'intent.sock';

export function createAvatarIntentSocket(opts: AvatarIntentSocketOptions): AvatarIntentSocket {
  return new LocalAvatarIntentSocket(opts);
}

/**
 * The daemon-hosted UPSTREAM socket (overlay -> daemon), the reverse direction of
 * avatar.sock. A connected overlay writes NDJSON intent frames; each line is
 * decoded with parseIntent and the non-null result is handed to onIntent.
 *
 * Fire-and-forget: there is NO ack frame (the overlay does not wait). Inbound-only;
 * the server never writes back. Mirrors daemon.ts / avatarPublishSocket.ts socket
 * discipline (inside-root guard, stale-socket probe-then-unlink / throw-if-live,
 * connection Set cleanup). A malformed line is silently dropped; a dropped
 * connection never breaks the server.
 */
class LocalAvatarIntentSocket implements AvatarIntentSocket {
  readonly socketPath: string;

  private readonly stateRoot: string;
  private readonly onIntent: (intent: AvatarIntent) => void;
  private server: Server | undefined;
  private readonly connections = new Set<Socket>();
  private listening = false;
  private stopping: Promise<void> | undefined;

  constructor(opts: AvatarIntentSocketOptions) {
    this.stateRoot = resolveStateRoot(opts.stateRoot);
    this.socketPath = resolveSocketPath(this.stateRoot, opts.socketPath);
    this.onIntent = opts.onIntent;
  }

  get isListening(): boolean {
    return this.listening;
  }

  async start(): Promise<void> {
    if (this.listening) {
      return;
    }

    ensureInsideStateRoot(this.stateRoot, this.socketPath);
    await mkdir(this.stateRoot, { recursive: true });
    await mkdir(dirname(this.socketPath), { recursive: true });
    await removeStaleSocketOrFail(this.socketPath);

    this.server = createServer((socket) => this.handleConnection(socket));
    this.server.on('error', () => {
      this.listening = false;
    });

    await new Promise<void>((resolveStart, rejectStart) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        rejectStart(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        this.listening = true;
        resolveStart();
      };

      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(this.socketPath);
    });
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return this.stopping;
    }

    this.stopping = this.stopOnce();
    try {
      await this.stopping;
    } finally {
      this.stopping = undefined;
    }
  }

  private async stopOnce(): Promise<void> {
    const server = this.server;
    this.server = undefined;

    if (server) {
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
        closeAllConnections(server, this.connections);
      });
    } else {
      closeAllTrackedConnections(this.connections);
    }

    this.listening = false;
    await rm(this.socketPath, { force: true });
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    this.connections.add(socket);
    let buffer = '';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        this.processLine(line);
      }
    });

    socket.on('error', () => {
      this.connections.delete(socket);
      socket.destroy();
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });
  }

  private processLine(line: string): void {
    const intent = parseIntent(line);
    if (intent === null) {
      return;
    }

    try {
      this.onIntent(intent);
    } catch {
      // One handler failure must never break the reader or the server.
    }
  }
}

function resolveStateRoot(stateRoot: string | undefined): string {
  return stateRoot ? resolve(stateRoot) : resolveStateRootFromEnv(process.env);
}

function resolveSocketPath(stateRoot: string, socketPath: string | undefined): string {
  if (!socketPath) {
    return join(stateRoot, DEFAULT_SOCKET_NAME);
  }

  return isAbsolute(socketPath) ? resolve(socketPath) : resolve(stateRoot, socketPath);
}

function ensureInsideStateRoot(stateRoot: string, targetPath: string): void {
  const rel = relative(stateRoot, targetPath);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return;
  }

  throw new Error(`socketPath must be inside stateRoot: ${targetPath}`);
}

async function removeStaleSocketOrFail(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) {
    return;
  }

  const live = await canConnect(socketPath);
  if (live) {
    throw new Error(`socket already in use: ${socketPath}`);
  }

  await rm(socketPath, { force: true });
}

async function canConnect(socketPath: string): Promise<boolean> {
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

function closeAllConnections(server: Server, connections: Set<Socket>): void {
  const closeAll = (server as Server & { closeAllConnections?: () => void }).closeAllConnections;
  if (typeof closeAll === 'function') {
    closeAll.call(server);
    return;
  }

  closeAllTrackedConnections(connections);
}

function closeAllTrackedConnections(connections: Set<Socket>): void {
  for (const socket of connections) {
    socket.destroy();
  }
}
