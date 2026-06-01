import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { resolveStateRootFromEnv, type RawHookEvent } from './daemon.js';

export type DropReason = 'daemon-unreachable' | 'send-timeout' | 'send-error';

export type BridgeResult =
  | { status: 'sent' }
  | { status: 'dropped'; reason: DropReason };

type ForwardHookEventOptions = {
  hook: string;
  stdin: string;
  socketPath: string;
  now: () => string;
  timeoutMs?: number;
};

export function resolveSocketPath(env: NodeJS.ProcessEnv): string {
  return join(resolveStateRootFromEnv(env), 'daemon.sock');
}

export async function forwardHookEvent(opts: ForwardHookEventOptions): Promise<BridgeResult> {
  try {
    return await sendHookEvent(opts);
  } catch {
    return { status: 'dropped', reason: 'send-error' };
  }
}

function sendHookEvent(opts: ForwardHookEventOptions): Promise<BridgeResult> {
  return new Promise((resolveResult) => {
    const timeoutMs = opts.timeoutMs ?? 1000;
    const line = `${JSON.stringify(toRawHookEvent(opts))}\n`;
    let socket: Socket | undefined;
    let settled = false;

    const settle = (result: BridgeResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket?.removeAllListeners();
      resolveResult(result);
    };

    const timeout = setTimeout(() => {
      socket?.destroy();
      settle({ status: 'dropped', reason: 'send-timeout' });
    }, timeoutMs);

    try {
      socket = createConnection(opts.socketPath);
      socket.resume();
    } catch {
      clearTimeout(timeout);
      resolveResult({ status: 'dropped', reason: 'send-error' });
      return;
    }

    socket.once('connect', () => {
      socket.write(line, (error) => {
        if (error) {
          settle({ status: 'dropped', reason: 'send-error' });
          socket?.destroy();
          return;
        }

        socket?.end();
      });
    });

    socket.once('close', (hadError) => {
      settle(hadError ? { status: 'dropped', reason: 'send-error' } : { status: 'sent' });
    });

    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        settle({ status: 'dropped', reason: 'daemon-unreachable' });
        return;
      }

      settle({ status: 'dropped', reason: 'send-error' });
    });
  });
}

function toRawHookEvent(opts: ForwardHookEventOptions): RawHookEvent {
  const payload = parsePayload(opts.stdin);

  return {
    v: 1,
    hook: opts.hook,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : '',
    ts: opts.now(),
    payload,
  };
}

function parsePayload(stdin: string): Record<string, unknown> {
  if (typeof stdin !== 'string') {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(stdin);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
