import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecisionLedger } from '../src/ledger.js';
import { createRoutingSubscriber, createEventSink } from '../src/bus.js';
import { normalize } from '../src/normalize.js';
import { route } from '../src/router.js';
import type { RawHookEvent } from '../src/daemon.js';
import type { RoutedEvent } from '../src/bus.js';

describe('Decision Ledger (src/ledger.ts)', () => {
  let tempDir: string;

  const createTempDir = () => mkdtempSync(join(tmpdir(), 'familiar-test-'));
  
  const rawEventA: RawHookEvent = {
    v: 1, hook: 'Stop', sessionId: 's1', ts: '2026-06-01T10:00:00Z', payload: {}
  };
  const rawEventB: RawHookEvent = {
    v: 1, hook: 'Notification', sessionId: 's1', ts: '2026-06-01T10:01:00Z', payload: { message: 'hi' }
  };
  const eventA = normalize(rawEventA);
  const eventB = normalize(rawEventB);
  
  const routedA: RoutedEvent = { event: eventA, decision: route(eventA) };
  const routedB: RoutedEvent = { event: eventB, decision: route(eventB) };

  it('Criterion 6: Ledger write+read with exact mapping', async () => {
    tempDir = createTempDir();
    const dbPath = join(tempDir, 'ledger.db');
    const ledger = createDecisionLedger({ dbPath });

    try {
      ledger.sink(routedA);
      ledger.sink(routedB);
      await ledger.flush();

      const rows = ledger.recent();
      expect(rows).toHaveLength(2);
      
      // Sorted by id DESC (most recent first)
      const rowB = rows[0];
      const rowA = rows[1];

      expect(rowB.hook).toBe('Notification');
      expect(rowB.sessionId).toBe('s1');
      expect(rowB.kind).toBe('notification');
      expect(rowB.channel).toBe(routedB.decision.channel);
      expect(rowB.reason).toBe(routedB.decision.reason);
      expect(rowB.ts).toBe(eventB.ts);
      expect(typeof rowB.id).toBe('number');

      expect(rowA.hook).toBe('Stop');
      expect(rowA.sessionId).toBe('s1');
      expect(rowA.kind).toBe('run-finished');
    } finally {
      await ledger.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Criterion 7 & 8: Silent rows recorded and limit applied', async () => {
    tempDir = createTempDir();
    const ledger = createDecisionLedger({ dbPath: join(tempDir, 'l.db') });

    try {
      const silentEvent = normalize({
        v: 1, hook: 'Other', sessionId: 's2', ts: '2026-06-01T10:05:00Z', payload: {}
      });
      const silentRouted: RoutedEvent = { 
        event: silentEvent, 
        decision: { channel: 'none', reason: 'silent' } 
      };

      ledger.sink(silentRouted);
      await ledger.flush();

      const rows = ledger.recent(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].channel).toBe('none');
      expect(rows[0].reason).toBe('silent');
    } finally {
      await ledger.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Criterion 9 & 10: Deferral/non-blocking and empty flush', async () => {
    tempDir = createTempDir();
    const ledger = createDecisionLedger({ dbPath: join(tempDir, 'defer.db') });

    try {
      // Criterion 10: empty flush
      await expect(ledger.flush()).resolves.toBeUndefined();
      expect(ledger.recent()).toEqual([]);

      // Criterion 9: Deferral
      // sink() should not throw
      expect(() => ledger.sink(routedA)).not.toThrow();
      
      // Synchronously after sink, recent() should still be empty
      expect(ledger.recent()).toEqual([]);

      // After flush, it is visible
      await ledger.flush();
      expect(ledger.recent()).toHaveLength(1);
    } finally {
      await ledger.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Criterion 11: Persistence across reopen', async () => {
    tempDir = createTempDir();
    const dbPath = join(tempDir, 'persist.db');
    
    // First session
    const ledger1 = createDecisionLedger({ dbPath });
    ledger1.sink(routedA);
    await ledger1.flush();
    await ledger1.close();

    // Second session
    const ledger2 = createDecisionLedger({ dbPath });
    try {
      const rows = ledger2.recent();
      expect(rows).toHaveLength(1);
      expect(rows[0].hook).toBe('Stop');
    } finally {
      await ledger2.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Criterion 12: Default path under FAMILIAR_HOME', async () => {
    tempDir = createTempDir();
    const originalHome = process.env.FAMILIAR_HOME;
    process.env.FAMILIAR_HOME = tempDir;

    try {
      const ledger = createDecisionLedger(); // No dbPath
      const expectedFile = join(tempDir, 'ledger.db');
      
      ledger.sink(routedA);
      await ledger.flush();
      
      expect(existsSync(expectedFile)).toBe(true);
      await ledger.close();
    } finally {
      process.env.FAMILIAR_HOME = originalHome;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Criterion 13: Schema append-only-shaped (API surface check)', () => {
    tempDir = createTempDir();
    const ledger = createDecisionLedger({ dbPath: join(tempDir, 'api.db') });
    
    // Interface check: only sink, flush, recent, close should be present
    const keys = Object.keys(ledger);
    // readonly sink is usually on the object, others might be on prototype or object
    // but the contract says it exposes only these.
    expect(ledger).toHaveProperty('sink');
    expect(typeof ledger.flush).toBe('function');
    expect(typeof ledger.recent).toBe('function');
    expect(typeof ledger.close).toBe('function');
    
    // No update/delete
    expect(ledger).not.toHaveProperty('update');
    expect(ledger).not.toHaveProperty('delete');
    expect(ledger).not.toHaveProperty('remove');

    ledger.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('Criterion 14: End-to-end through the bus', async () => {
    tempDir = createTempDir();
    const ledger = createDecisionLedger({ dbPath: join(tempDir, 'e2e.db') });

    try {
      // Set up bus: EventSink -> RoutingSubscriber -> LedgerSink
      const routingSubscriber = createRoutingSubscriber({ sinks: [ledger.sink] });
      const eventSink = createEventSink([routingSubscriber]);

      // Feed RawHookEvent
      eventSink(rawEventA); // 'Stop' -> 'run-finished'

      await ledger.flush();
      const rows = ledger.recent();
      
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('run-finished');
      expect(rows[0].channel).toBe('notification');
      expect(rows[0].reason).toBe('run-finished');
      expect(rows[0].hook).toBe('Stop');
    } finally {
      await ledger.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Criterion 15: Totality and adversarial events', async () => {
    tempDir = createTempDir();
    const dbPath = join(tempDir, 'totality.db');
    const ledger = createDecisionLedger({ dbPath });

    try {
      // Assert freshly-opened ledger is empty
      expect(ledger.recent()).toEqual([]);

      const adversarialEvents = [
        normalize({ v: 1, hook: '', sessionId: '', ts: '', payload: {} }),
        normalize({ v: 1, hook: 'Unknown', sessionId: '!!!', ts: 'not-a-date', payload: { foo: 'bar' } }),
      ];

      const channels = ['none', 'audio', 'notification'] as const;
      
      for (const event of adversarialEvents) {
        for (const channel of channels) {
          const routed: RoutedEvent = {
            event,
            decision: { channel, reason: '' }
          };
          expect(() => ledger.sink(routed)).not.toThrow();
        }
      }

      await ledger.flush();
      const rows = ledger.recent();
      expect(rows.length).toBe(adversarialEvents.length * channels.length);
      
      // Verify recent() returns [] when empty (already checked above, but let's be sure)
      const emptyLedger = createDecisionLedger({ dbPath: join(tempDir, 'empty.db') });
      try {
        expect(emptyLedger.recent()).toEqual([]);
      } finally {
        await emptyLedger.close();
      }
    } finally {
      await ledger.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
