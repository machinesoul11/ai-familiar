import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type RawHookEvent = {
  v: 1;
  hook: string;
  sessionId: string;
  ts: string;
  payload: object;
};

export type Ack = { ok: true } | { ok: false; error: string };

export interface Daemon {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly socketPath: string;
  readonly isListening: boolean;
}

type DaemonOptions = {
  stateRoot?: string;
  socketPath?: string;
  sink?: (e: RawHookEvent) => void;
};

type ValidationResult =
  | { ok: true; event: RawHookEvent }
  | { ok: false; error: string };

type SignalName = 'SIGTERM' | 'SIGINT';

const DEFAULT_STATE_ROOT_NAME = '.familiar';
const DEFAULT_SOCKET_NAME = 'daemon.sock';

export function createDaemon(opts: DaemonOptions = {}): Daemon {
  return new LocalDaemon(opts);
}

export function resolveStateRootFromEnv(env: NodeJS.ProcessEnv): string {
  return resolve(env.FAMILIAR_HOME ?? join(homedir(), DEFAULT_STATE_ROOT_NAME));
}

class LocalDaemon implements Daemon {
  readonly socketPath: string;

  private readonly stateRoot: string;
  private readonly deliver: (event: RawHookEvent) => void;
  private server: Server | undefined;
  private readonly connections = new Set<Socket>();
  private listening = false;
  private stopping: Promise<void> | undefined;
  private signalHandler: (() => Promise<void>) | undefined;

  constructor(opts: DaemonOptions) {
    this.stateRoot = resolveStateRoot(opts.stateRoot);
    this.socketPath = resolveSocketPath(this.stateRoot, opts.socketPath);
    this.deliver = opts.sink ?? defaultSink;
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

    console.log(JSON.stringify({ daemon: 'familiar', stateRoot: this.stateRoot }));
    this.registerSignalHandlers();
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
    this.unregisterSignalHandlers();

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
        this.processLine(socket, line);
      }
    });

    socket.on('error', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });
  }

  private processLine(socket: Socket, line: string): void {
    const validation = parseAndValidate(line);
    if (!validation.ok) {
      writeAck(socket, { ok: false, error: validation.error });
      return;
    }

    try {
      this.deliver(validation.event);
    } catch (error) {
      console.error(JSON.stringify({
        daemon: 'familiar',
        event: 'sink_error',
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    writeAck(socket, { ok: true });
  }

  private registerSignalHandlers(): void {
    if (this.signalHandler) {
      return;
    }

    this.signalHandler = async () => {
      await this.stop();
      process.exit(0);
    };

    for (const signal of ['SIGTERM', 'SIGINT'] satisfies SignalName[]) {
      process.on(signal, this.signalHandler);
    }
  }

  private unregisterSignalHandlers(): void {
    if (!this.signalHandler) {
      return;
    }

    for (const signal of ['SIGTERM', 'SIGINT'] satisfies SignalName[]) {
      process.off(signal, this.signalHandler);
    }
    this.signalHandler = undefined;
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

function parseAndValidate(line: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }

  if (!isPlainRecord(parsed)) {
    return { ok: false, error: 'event must be a JSON object' };
  }

  if (parsed.v !== 1) {
    return { ok: false, error: 'v must be 1' };
  }

  if (typeof parsed.hook !== 'string' || parsed.hook.length === 0) {
    return { ok: false, error: 'hook must be a non-empty string' };
  }

  if (typeof parsed.ts !== 'string') {
    return { ok: false, error: 'ts must be a string' };
  }

  const payload = parsed.payload ?? {};
  if (!isPlainRecord(payload)) {
    return { ok: false, error: 'payload must be an object' };
  }

  return {
    ok: true,
    event: {
      v: 1,
      hook: parsed.hook,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
      ts: parsed.ts,
      payload,
    },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeAck(socket: Socket, ack: Ack): void {
  socket.write(`${JSON.stringify(ack)}\n`);
}

function closeAllConnections(server: Server, connections: Set<Socket>): void {
  const closeAll = (server as Server & { closeAllConnections?: () => void }).closeAllConnections;
  if (typeof closeAll === 'function') {
    closeAll.call(server);
    return;
  }

  for (const socket of connections) {
    socket.destroy();
  }
}

function defaultSink(event: RawHookEvent): void {
  console.log(JSON.stringify(event));
}
