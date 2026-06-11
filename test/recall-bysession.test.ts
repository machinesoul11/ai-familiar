import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecisionLedger } from '../src/ledger.js';
import { normalize } from '../src/normalize.js';
import { route } from '../src/router.js';
import type { RawHookEvent } from '../src/daemon.js';
import type { RoutedEvent } from '../src/bus.js';

describe('ledger bySession', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'familiar-test-recall-'));
    dbPath = join(tempDir, 'ledger.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns only rows for that sessionId, ordered by id ASC (AC 14, 16)', async () => {
    const ledger = createDecisionLedger({ dbPath });
    
    // Using chronological order for events
    const events: RawHookEvent[] = [
      { v: 1, hook: 'SessionStart', sessionId: 's1', ts: '2026-06-01T10:00:00Z', payload: {} },
      { v: 1, hook: 'Stop', sessionId: 's2', ts: '2026-06-01T10:00:01Z', payload: {} },
      { v: 1, hook: 'Stop', sessionId: 's1', ts: '2026-06-01T10:00:02Z', payload: {} },
    ];

    for (const raw of events) {
      const ev = normalize(raw);
      const routed: RoutedEvent = { 
        event: ev, 
        decision: route(ev) 
      };
      ledger.sink(routed);
    }

    // AC 16: Reads only already-flushed rows
    await ledger.flush();

    const s1Rows = ledger.bySession('s1');
    expect(s1Rows).toHaveLength(2);
    expect(s1Rows[0].sessionId).toBe('s1');
    expect(s1Rows[1].sessionId).toBe('s1');
    
    // AC 14: ordered by id ASC (chronological)
    expect(s1Rows[0].id).toBeLessThan(s1Rows[1].id);
    expect(s1Rows[0].hook).toBe('SessionStart');
    expect(s1Rows[1].hook).toBe('Stop');

    await ledger.close();
  });

  it('returns [] for an unknown/empty sessionId (AC 15)', async () => {
    const ledger = createDecisionLedger({ dbPath });
    
    const raw: RawHookEvent = { v: 1, hook: 'Stop', sessionId: 's1', ts: '2026-06-01T10:00:00Z', payload: {} };
    const ev = normalize(raw);
    ledger.sink({ event: ev, decision: route(ev) });
    await ledger.flush();

    expect(ledger.bySession('ghost')).toEqual([]);
    expect(ledger.bySession('')).toEqual([]);

    await ledger.close();
  });

  it('does not change existing recent / sink / flush / close behavior (AC 17)', async () => {
    const ledger = createDecisionLedger({ dbPath });
    const raw: RawHookEvent = { v: 1, hook: 'Stop', sessionId: 's1', ts: '2026-06-01T10:00:00Z', payload: {} };
    const ev = normalize(raw);
    const routed: RoutedEvent = { 
      event: ev, 
      decision: route(ev) 
    };
    
    ledger.sink(routed);
    await ledger.flush();
    
    const recent = ledger.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0].sessionId).toBe('s1');
    
    await ledger.close();
  });
});
