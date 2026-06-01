import type { RawHookEvent } from './daemon.js';

export type EventKind =
  | 'session-start'
  | 'run-finished'
  | 'subagent-finished'
  | 'notification'
  | 'session-end'
  | 'unknown';

interface NormalizedBase {
  v: 1;
  kind: EventKind;
  hook: string;
  sessionId: string;
  ts: string;
  raw: RawHookEvent;
}

export type NormalizedEvent =
  | (NormalizedBase & { kind: 'session-start'; source: string })
  | (NormalizedBase & { kind: 'run-finished' })
  | (NormalizedBase & { kind: 'subagent-finished' })
  | (NormalizedBase & { kind: 'notification'; message: string })
  | (NormalizedBase & { kind: 'session-end'; reason: string })
  | (NormalizedBase & { kind: 'unknown' });

type Adapter = (base: NormalizedBase, raw: RawHookEvent) => NormalizedEvent;

const adapterRegistry: Record<string, Adapter> = {
  SessionStart: (base, raw) => ({
    ...base,
    kind: 'session-start',
    source: stringField(raw.payload, 'source'),
  }),
  Stop: (base) => ({
    ...base,
    kind: 'run-finished',
  }),
  SubagentStop: (base) => ({
    ...base,
    kind: 'subagent-finished',
  }),
  Notification: (base, raw) => ({
    ...base,
    kind: 'notification',
    message: stringField(raw.payload, 'message'),
  }),
  SessionEnd: (base, raw) => ({
    ...base,
    kind: 'session-end',
    reason: stringField(raw.payload, 'reason'),
  }),
};

const adapters: Record<string, Adapter> = Object.assign(
  Object.create(null),
  adapterRegistry,
);

export function normalize(raw: RawHookEvent): NormalizedEvent {
  const base: NormalizedBase = {
    v: 1,
    kind: 'unknown',
    hook: raw.hook,
    sessionId: raw.sessionId,
    ts: raw.ts,
    raw,
  };

  return (adapters[raw.hook] ?? unknownAdapter)(base, raw);
}

function unknownAdapter(base: NormalizedBase): NormalizedEvent {
  return {
    ...base,
    kind: 'unknown',
  };
}

function stringField(payload: unknown, key: string): string {
  if (payload === null || typeof payload !== 'object') {
    return '';
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}
