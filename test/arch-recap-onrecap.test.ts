import { describe, it, expect } from 'vitest';
import { createArchRecapSubscriber } from '../src/archRecap.js';
import type { ArchRecapDeps, SessionBase } from '../src/archRecap.js';
import type { ArchSummary } from '../src/summary.js';

type NormalizedEvent = any;

interface FakeDeps extends ArchRecapDeps {
  writes: string[];
  onRecapCalls: ArchSummary[];
  capturedTask: (() => void) | null;
}

function createFakeDeps(overrides: Partial<ArchRecapDeps> = {}): FakeDeps {
  const store = new Map<string, SessionBase>();
  store.set('session-123', { baseRef: 'main', cwd: '/test' });

  const deps: FakeDeps = {
    writes: [],
    onRecapCalls: [],
    capturedTask: null,
    
    captureBase: () => 'main',
    makeReader: () => ({ 
      diffNameStatus: () => null, 
      listUntracked: () => [], 
      showBlob: () => null, 
      readWorking: () => null 
    } as any),
    writeRecap(text: string) {
      this.writes.push(text);
    },
    defer(task: () => void) {
      // By default, execute immediately to test side effects easily
      task();
    },
    store,
    onRecap(summary: ArchSummary) {
      this.onRecapCalls.push(summary);
    },
    ...overrides
  };
  
  // Bind 'this' explicitly for overrides/default methods that use 'this'
  deps.writeRecap = deps.writeRecap.bind(deps);
  deps.defer = deps.defer.bind(deps);
  deps.onRecap = deps.onRecap!.bind(deps);
  
  return deps;
}

function makeEvent(kind: string, sessionId: string = 'session-123'): NormalizedEvent {
  return {
    kind,
    sessionId,
    v: 1,
    hook: 'test',
    ts: '0',
    raw: { payload: { cwd: '/test' } }
  };
}

describe('Arch Recap onRecap seam (AC 18-21)', () => {
  it('AC18: On run-finished with recorded base -> onRecap is called once with ArchSummary', () => {
    const deps = createFakeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    
    subscriber(makeEvent('run-finished'));
    
    expect(deps.onRecapCalls.length).toBe(1);
    const summary = deps.onRecapCalls[0];
    expect(summary.kind).toBe('arch-summary');
    expect(Array.isArray(summary.modules)).toBe(true);
    // writeRecap should also have been called
    expect(deps.writes.length).toBe(1);
  });

  it('AC19: onRecap omitted -> run-finished produces recap exactly as 2.8; no throw', () => {
    // We intentionally omit onRecap from deps
    const deps = createFakeDeps();
    delete deps.onRecap; // removing the method
    
    const subscriber = createArchRecapSubscriber(deps);
    
    expect(() => {
      subscriber(makeEvent('run-finished'));
    }).not.toThrow();
    
    // writing still works just like 2.8
    expect(deps.writes.length).toBe(1);
  });

  it('AC20: onRecap is NOT called on other events or when no base is recorded', () => {
    const deps = createFakeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    
    const otherEvents = [
      'session-start', 
      'session-end', 
      'subagent-finished', 
      'notification', 
      'unknown'
    ];
    
    for (const kind of otherEvents) {
      subscriber(makeEvent(kind));
    }
    
    // Also test run-finished but missing base
    subscriber(makeEvent('run-finished', 'missing-session'));
    
    expect(deps.onRecapCalls.length).toBe(0);
    // Ensure writes is also 0 from these runs
    expect(deps.writes.length).toBe(0);
  });

  it('AC21: onRecap runs inside the deferred task (not synchronously before defer fires)', () => {
    let capturedTask: (() => void) | null = null;
    const deps = createFakeDeps({
      defer(task: () => void) {
        capturedTask = task;
      }
    });
    
    const subscriber = createArchRecapSubscriber(deps);
    
    subscriber(makeEvent('run-finished'));
    
    // Before task runs
    expect(capturedTask).not.toBeNull();
    expect(deps.writes.length).toBe(0);
    expect(deps.onRecapCalls.length).toBe(0);
    
    // Run the captured task
    capturedTask!();
    
    // After task runs
    expect(deps.writes.length).toBe(1);
    expect(deps.onRecapCalls.length).toBe(1);
  });
});