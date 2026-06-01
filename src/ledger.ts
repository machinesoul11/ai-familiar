import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveStateRootFromEnv } from './daemon.js';
import type { DecisionSink } from './bus.js';
import type { EventKind } from './normalize.js';
import type { Channel } from './router.js';

export interface LedgerRow {
  id: number;
  ts: string;
  hook: string;
  sessionId: string;
  kind: EventKind;
  channel: Channel;
  reason: string;
}

export interface DecisionLedger {
  readonly sink: DecisionSink;
  flush(): Promise<void>;
  recent(limit?: number): LedgerRow[];
  close(): Promise<void>;
}

interface PendingRow {
  seq: number;
  ts: string;
  hook: string;
  sessionId: string;
  kind: EventKind;
  channel: Channel;
  reason: string;
}

interface FlushWaiter {
  targetSeq: number;
  resolve(): void;
  reject(error: unknown): void;
}

type DbDecisionRow = {
  id: number;
  ts: string;
  hook: string;
  session_id: string;
  kind: EventKind;
  channel: Channel;
  reason: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  hook       TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  channel    TEXT NOT NULL,
  reason     TEXT NOT NULL
);
`;

export function createDecisionLedger(opts: {
  dbPath?: string;
  stateRoot?: string;
} = {}): DecisionLedger {
  const dbPath = opts.dbPath ?? join(
    opts.stateRoot ?? resolveStateRootFromEnv(process.env),
    'ledger.db',
  );
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const insert = db.prepare(`
    INSERT INTO decisions (ts, hook, session_id, kind, channel, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let pending: PendingRow[] = [];
  let waiters: FlushWaiter[] = [];
  let nextSeq = 0;
  let flushedSeq = 0;
  let drainScheduled = false;
  let drainInFlight = false;

  const scheduleDrain = () => {
    if (drainScheduled || drainInFlight) {
      return;
    }

    drainScheduled = true;
    setImmediate(drain);
  };

  const settleWaiters = () => {
    const remaining: FlushWaiter[] = [];

    for (const waiter of waiters) {
      if (waiter.targetSeq <= flushedSeq) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }

    waiters = remaining;
  };

  const rejectWaiters = (error: unknown) => {
    const rejecting = waiters;
    waiters = [];

    for (const waiter of rejecting) {
      waiter.reject(error);
    }
  };

  function drain(): void {
    drainScheduled = false;

    if (pending.length === 0) {
      settleWaiters();
      return;
    }

    drainInFlight = true;
    const batch = pending;
    pending = [];

    try {
      db.exec('BEGIN');
      try {
        for (const row of batch) {
          insert.run(
            row.ts,
            row.hook,
            row.sessionId,
            row.kind,
            row.channel,
            row.reason,
          );
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      flushedSeq = Math.max(flushedSeq, batch[batch.length - 1]?.seq ?? flushedSeq);
      settleWaiters();
    } catch (error) {
      rejectWaiters(error);
    } finally {
      drainInFlight = false;
      if (pending.length > 0) {
        scheduleDrain();
      }
    }
  }

  const sink: DecisionSink = (routed) => {
    try {
      pending.push({
        seq: ++nextSeq,
        ts: routed.event.ts,
        hook: routed.event.hook,
        sessionId: routed.event.sessionId,
        kind: routed.event.kind,
        channel: routed.decision.channel,
        reason: routed.decision.reason,
      });
      scheduleDrain();
    } catch {
      // The ledger is a best-effort decision sink and must never break delivery.
    }
  };

  const flush = (): Promise<void> => {
    const targetSeq = nextSeq;

    if (targetSeq <= flushedSeq && pending.length === 0 && !drainInFlight) {
      return Promise.resolve();
    }

    scheduleDrain();

    return new Promise<void>((resolve, reject) => {
      waiters.push({ targetSeq, resolve, reject });
    });
  };

  const recent = (limit?: number): LedgerRow[] => {
    const rows = limit === undefined
      ? db.prepare(`
        SELECT id, ts, hook, session_id, kind, channel, reason
        FROM decisions
        ORDER BY id DESC
      `).all()
      : db.prepare(`
        SELECT id, ts, hook, session_id, kind, channel, reason
        FROM decisions
        ORDER BY id DESC
        LIMIT ?
      `).all(limit);

    return rows.map((row) => mapLedgerRow(row as DbDecisionRow));
  };

  const close = async (): Promise<void> => {
    await flush();
    db.close();
  };

  return {
    sink,
    flush,
    recent,
    close,
  };
}

function mapLedgerRow(row: DbDecisionRow): LedgerRow {
  return {
    id: row.id,
    ts: row.ts,
    hook: row.hook,
    sessionId: row.session_id,
    kind: row.kind,
    channel: row.channel,
    reason: row.reason,
  };
}
