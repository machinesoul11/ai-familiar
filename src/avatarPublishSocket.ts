import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { FrameSink } from './avatarBackend.js';
import { resolveStateRootFromEnv } from './daemon.js';

export interface AvatarPublishSocket {
  readonly sink: FrameSink;
  readonly socketPath: string;
  readonly isListening: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type AvatarPublishSocketOptions = {
  stateRoot?: string;
  socketPath?: string;
};

const DEFAULT_SOCKET_NAME = 'avatar.sock';

export function createAvatarPublishSocket(opts: AvatarPublishSocketOptions = {}): AvatarPublishSocket {
  return new LocalAvatarPublishSocket(opts);
}

class LocalAvatarPublishSocket implements AvatarPublishSocket {
  readonly socketPath: string;
  readonly sink: FrameSink;

  private readonly stateRoot: string;
  private server: Server | undefined;
  private readonly connections = new Set<Socket>();
  private listening = false;
  private stopping: Promise<void> | undefined;

  constructor(opts: AvatarPublishSocketOptions) {
    this.stateRoot = resolveStateRoot(opts.stateRoot);
    this.socketPath = resolveSocketPath(this.stateRoot, opts.socketPath);
    this.sink = {
      write: (line: string) => {
        for (const socket of this.connections) {
          try {
            socket.write(line);
          } catch {
            // One failed subscriber write must not break fan-out.
          }
        }
      },
    };
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
    this.connections.add(socket);

    socket.on('data', () => {
      // Publish-only: subscribers may write, but inbound data has no protocol.
    });

    socket.on('error', () => {
      this.connections.delete(socket);
      socket.destroy();
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });
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
