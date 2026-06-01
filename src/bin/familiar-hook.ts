import { forwardHookEvent, resolveSocketPath } from '../bridge.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  try {
    const stdin = await readStdin();
    const payload = parseJsonObject(stdin);
    const hook = process.argv[2] || (
      typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'Unknown'
    );

    await forwardHookEvent({
      hook,
      stdin,
      socketPath: resolveSocketPath(process.env),
      now: () => new Date().toISOString(),
    });
  } catch {
    // The hook bridge must never fail the caller.
  } finally {
    process.exit(0);
  }
}

function parseJsonObject(stdin: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(stdin);
    if (isJsonObject(parsed)) {
      return parsed;
    }
  } catch {
    return {};
  }

  return {};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void main();
