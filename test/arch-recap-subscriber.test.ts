
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createArchRecapSubscriber,
  type ArchRecapDeps,
  type SessionBase,
} from '../src/archRecap.js';
import type { NormalizedEvent } from '../src/normalize.js';
import { readChange, type RepoReader } from '../src/changeReader.js';
import { parseManifest, MANIFEST_PATH } from '../src/manifestLoader.js';
import { buildArchSummary } from '../src/summary.js';
import { formatArchRecap } from '../src/recap.js';

// CONTRACT CONCERNS: None. The contract is clear and testable.

const makeEvent = (
  kind: NormalizedEvent['kind'],
  sessionId: string,
  payload: object,
  other: object = {}
): NormalizedEvent => {
  const ts = new Date().toISOString();
  return {
    v: 1,
    kind,
    hook: 'TestHook',
    sessionId,
    ts,
    raw: {
      v: 1,
      hook: 'TestHook',
      sessionId,
      ts,
      payload,
    },
    ...other,
  } as NormalizedEvent;
};

class FakeRepoReader implements RepoReader {
  diffResult: string | null = '';
  untracked: string[] = [];
  blobs = new Map<string, string | null>();
  working = new Map<string, string | null>();

  diffNameStatus(ref: string): string | null {
    return this.diffResult;
  }

  listUntracked(): string[] {
    return this.untracked;
  }

  showBlob(ref: string, path: string): string | null {
    return this.blobs.get(`${ref} ${path}`) ?? null;
  }

  readWorking(path: string): string | null {
    return this.working.get(path) ?? null;
  }
}

describe('createArchRecapSubscriber', () => {
  let deps: ArchRecapDeps;
  let captureBase: vi.Mock;
  let makeReader: vi.Mock;
  let writeRecap: vi.Mock;
  let defer: vi.Mock;
  let store: Map<string, SessionBase>;
  let fakeReader: FakeRepoReader;

  beforeEach(() => {
    captureBase = vi.fn();
    makeReader = vi.fn();
    writeRecap = vi.fn();
    defer = vi.fn((task) => task()); // Default to synchronous execution
    store = new Map<string, SessionBase>();
    fakeReader = new FakeRepoReader();

    deps = {
      captureBase,
      makeReader,
      writeRecap,
      defer,
      store,
    };
  });

  describe('Criterion 1, 2, 3, 12: session-start handling', () => {
    it('Criterion 1 & 12: captures and stores base ref and cwd on session-start', () => {
      const subscriber = createArchRecapSubscriber(deps);
      captureBase.mockReturnValue('BASE_SHA');
      const event = makeEvent('session-start', 's1', { cwd: '/repo' });

      subscriber(event);

      expect(defer).toHaveBeenCalledOnce();
      expect(captureBase).toHaveBeenCalledWith('/repo');
      expect(store.get('s1')).toEqual({ baseRef: 'BASE_SHA', cwd: '/repo' });
    });

    it('Criterion 2: stores nothing if captureBase returns null', () => {
      const subscriber = createArchRecapSubscriber(deps);
      captureBase.mockReturnValue(null);
      const event = makeEvent('session-start', 's1', { cwd: '/repo' });

      subscriber(event);

      expect(defer).toHaveBeenCalledOnce();
      expect(captureBase).toHaveBeenCalledWith('/repo');
      expect(store.has('s1')).toBe(false);
    });

    it.each([
      { case: 'null', cwd: null },
      { case: 'undefined', cwd: undefined },
      { case: 'empty string', cwd: '' },
      { case: 'non-string', cwd: 123 },
    ])('Criterion 3: does nothing if cwd is $case', ({ cwd }) => {
      const subscriber = createArchRecapSubscriber(deps);
      const event = makeEvent('session-start', 's1', { cwd });

      subscriber(event);

      expect(defer).not.toHaveBeenCalled();
      expect(captureBase).not.toHaveBeenCalled();
      expect(store.has('s1')).toBe(false);
    });
  });

  describe('Criterion 4, 5, 6, 7: run-finished handling', () => {
    it('Criterion 4: composes the full pipeline and writes a recap for a change with no manifest violation', () => {
      const baseRef = 'BASE_SHA';
      store.set('s1', { baseRef, cwd: '/repo/project' });
      const subscriber = createArchRecapSubscriber(deps);

      // Scenario: src/a/x.ts is modified to import from a different module, src/b.
      fakeReader.diffResult = 'M	src/a/x.ts';
      fakeReader.blobs.set(`${baseRef} src/a/x.ts`, 'export const x = 1;');
      fakeReader.working.set(
        'src/a/x.ts',
        `import { y } from '../b/y.js';
export const x = y;`
      );
      // No manifest file is present.
      fakeReader.working.set(MANIFEST_PATH, null);
      makeReader.mockReturnValue(fakeReader);

      const event = makeEvent('run-finished', 's1', { cwd: '/repo/project' });
      subscriber(event);

      expect(defer).toHaveBeenCalledOnce();
      expect(makeReader).toHaveBeenCalledWith('/repo/project');
      expect(writeRecap).toHaveBeenCalledOnce();

      // Compute expected recap by running the real functions on the same fake data.
      const change = readChange(fakeReader, baseRef);
      const manifest = parseManifest(fakeReader.readWorking(MANIFEST_PATH));
      const summary = buildArchSummary({
        files: change.files,
        contents: change.contents,
        manifest,
      });
      const expectedRecap = formatArchRecap(summary);

      expect(writeRecap).toHaveBeenCalledWith(expectedRecap);
      expect(expectedRecap).toContain('New cross-module coupling (1)');
      expect(expectedRecap).not.toContain('Boundary violations');
    });

    it('Criterion 7: threads the manifest and reports a violation', () => {
      const baseRef = 'VIOLATION_SHA';
      store.set('s2', { baseRef, cwd: '/repo' });
      const subscriber = createArchRecapSubscriber(deps);

      // Scenario from prompt: src/core/logic.ts imports from src/widgets
      fakeReader.diffResult = 'M	src/core/logic.ts';
      fakeReader.blobs.set(`${baseRef} src/core/logic.ts`, 'export const x = 0;');
      fakeReader.working.set(
        'src/core/logic.ts',
        `import { w } from '../widgets/w.js';
export const x = 1;`
      );
      // Manifest forbids this coupling
      fakeReader.working.set(
        MANIFEST_PATH,
        JSON.stringify({
          separate: [{ from: 'src/core', to: 'src/widgets', name: 'core-no-widgets' }],
        })
      );
      makeReader.mockReturnValue(fakeReader);

      const event = makeEvent('run-finished', 's2', { cwd: '/repo' });
      subscriber(event);

      expect(defer).toHaveBeenCalledOnce();
      expect(makeReader).toHaveBeenCalledWith('/repo');
      expect(writeRecap).toHaveBeenCalledOnce();

      // Compute expected by calling real functions
      const change = readChange(fakeReader, baseRef);
      const manifest = parseManifest(fakeReader.readWorking(MANIFEST_PATH));
      const summary = buildArchSummary({
        files: change.files,
        contents: change.contents,
        manifest,
      });
      const expectedRecap = formatArchRecap(summary);

      expect(writeRecap).toHaveBeenCalledWith(expectedRecap);
      // The crucial assertions proving the manifest was threaded
      expect(expectedRecap).toContain('New cross-module coupling (1)');
      expect(expectedRecap).toContain('Boundary violations (1)');
    });

    it('Criterion 5 (REVISED): does nothing if no base is stored, and does not defer', () => {
      const subscriber = createArchRecapSubscriber(deps);
      const event = makeEvent('run-finished', 's99', {}); // No base for s99
      subscriber(event);

      expect(defer).not.toHaveBeenCalled();
      expect(makeReader).not.toHaveBeenCalled();
      expect(writeRecap).not.toHaveBeenCalled();
    });

    it('Criterion 6: does nothing if makeReader returns null', () => {
      store.set('s3', { baseRef: 'ANY_SHA', cwd: '/not/a/repo' });
      const subscriber = createArchRecapSubscriber(deps);
      makeReader.mockReturnValue(null);
      const event = makeEvent('run-finished', 's3', {});
      subscriber(event);

      expect(defer).toHaveBeenCalledOnce();
      expect(makeReader).toHaveBeenCalledWith('/not/a/repo');
      expect(writeRecap).not.toHaveBeenCalled();
    });
  });

  describe('Criterion 8: Off the ack path', () => {
    it('defers all heavy work until the task is run', () => {
      const tasks: (() => void)[] = [];
      defer.mockImplementation((task) => tasks.push(task));
      const subscriber = createArchRecapSubscriber(deps);

      // 1. Dispatch events
      captureBase.mockReturnValue('DEFERRED_SHA');
      makeReader.mockReturnValue(fakeReader);
      store.set('s4', { baseRef: 'DEFERRED_SHA', cwd: '/repo' });
      const startEvent = makeEvent('session-start', 's4', { cwd: '/repo' });
      const finishEvent = makeEvent('run-finished', 's4', { cwd: '/repo' });

      subscriber(startEvent);
      subscriber(finishEvent);

      // 2. Assert nothing has happened yet
      expect(tasks.length).toBe(2);
      expect(captureBase).not.toHaveBeenCalled();
      expect(makeReader).not.toHaveBeenCalled();
      expect(writeRecap).not.toHaveBeenCalled();
      expect(store.get('s4')).toEqual({ baseRef: 'DEFERRED_SHA', cwd: '/repo' }); // store is updated synchronously for session-start setup

      // 3. Manually run the tasks
      tasks.forEach((task) => task());

      // 4. Assert the work was done
      expect(captureBase).toHaveBeenCalledWith('/repo');
      expect(makeReader).toHaveBeenCalledWith('/repo');
      expect(writeRecap).toHaveBeenCalledOnce();
    });
  });

  describe('Criterion C-RACE: Race condition between run-finished and session-end', () => {
    it('still writes a recap if session-end runs before the deferred task', () => {
      // Setup: queuing defer
      const tasks: (() => void)[] = [];
      defer.mockImplementation((task) => tasks.push(task));

      // Setup: A stored base and a change to analyze
      const baseRef = 'RACE_SHA';
      const sessionId = 's_race';
      store.set(sessionId, { baseRef, cwd: '/repo' });

      fakeReader.diffResult = 'M	src/a/x.ts';
      fakeReader.blobs.set(`${baseRef} src/a/x.ts`, 'export const x = 1;');
      fakeReader.working.set(
        'src/a/x.ts',
        `import { y } from '../b/y.js';
export const x = y;`
      );
      fakeReader.working.set(MANIFEST_PATH, null);
      makeReader.mockReturnValue(fakeReader);

      const subscriber = createArchRecapSubscriber(deps);

      // 1. Dispatch run-finished (which should capture the base and queue a task)
      const finishEvent = makeEvent('run-finished', sessionId, {});
      subscriber(finishEvent);

      // 2. Dispatch session-end synchronously (which should delete the base from the store)
      const endEvent = makeEvent('session-end', sessionId, {});
      subscriber(endEvent);

      // Assert preconditions before running the task
      expect(store.has(sessionId)).toBe(false); // Base is gone from the store
      expect(tasks.length).toBe(1); // One task was queued
      expect(writeRecap).not.toHaveBeenCalled(); // No I/O yet

      // 3. Manually run the deferred task
      tasks.forEach((task) => task());

      // 4. Assert the work was still done correctly
      expect(makeReader).toHaveBeenCalledWith('/repo');
      expect(writeRecap).toHaveBeenCalledOnce();

      // Compute expected recap to prove the captured base was used
      const change = readChange(fakeReader, baseRef);
      const manifest = parseManifest(fakeReader.readWorking(MANIFEST_PATH));
      const summary = buildArchSummary({
        files: change.files,
        contents: change.contents,
        manifest,
      });
      const expectedRecap = formatArchRecap(summary);

      expect(writeRecap).toHaveBeenCalledWith(expectedRecap);
      expect(expectedRecap).toContain('New cross-module coupling (1)');
    });
  });

  describe('Criterion 9 & 13: Exception safety and Totality', () => {
    it('Criterion 9: does not throw if captureBase throws in deferred task', () => {
      const subscriber = createArchRecapSubscriber(deps);
      const error = new Error('Capture failed');
      captureBase.mockImplementation(() => {
        throw error;
      });
      const event = makeEvent('session-start', 's5', { cwd: '/repo' });

      expect(() => subscriber(event)).not.toThrow();
    });

    it('Criterion 9: does not throw if makeReader throws in deferred task', () => {
      store.set('s6', { baseRef: 'SHA', cwd: '/repo' });
      const subscriber = createArchRecapSubscriber(deps);
      const error = new Error('Reader failed');
      makeReader.mockImplementation(() => {
        throw error;
      });
      const event = makeEvent('run-finished', 's6', {});

      expect(() => subscriber(event)).not.toThrow();
    });

    it('Criterion 9: does not throw if writeRecap throws in deferred task', () => {
      store.set('s7', { baseRef: 'SHA', cwd: '/repo' });
      const subscriber = createArchRecapSubscriber(deps);
      makeReader.mockReturnValue(fakeReader);
      const error = new Error('Write failed');
      writeRecap.mockImplementation(() => {
        throw error;
      });
      const event = makeEvent('run-finished', 's7', {});

      expect(() => subscriber(event)).not.toThrow();
    });

    it('Criterion 13: does not throw synchronously for any event', () => {
      const subscriber = createArchRecapSubscriber(deps);
      const events: NormalizedEvent[] = [
        makeEvent('session-start', 's8', {}),
        makeEvent('run-finished', 's8', {}),
        makeEvent('session-end', 's8', {}),
        makeEvent('subagent-finished', 's8', {}),
        makeEvent('notification', 's8', {}),
        makeEvent('unknown', 's8', {}),
        { v: 1, kind: 'malformed' } as any,
      ];

      events.forEach((event) => {
        expect(() => subscriber(event)).not.toThrow();
      });
    });
  });

  describe('Criterion 10: Other event kinds', () => {
    it.each([
      { kind: 'subagent-finished' as const },
      { kind: 'notification' as const },
      { kind: 'unknown' as const },
    ])('ignores $kind events', ({ kind }) => {
      const subscriber = createArchRecapSubscriber(deps);
      store.set('s10', { baseRef: 'SHA', cwd: '/repo' });
      const event = makeEvent(kind, 's10', {});
      subscriber(event);

      expect(defer).not.toHaveBeenCalled();
      expect(captureBase).not.toHaveBeenCalled();
      expect(makeReader).not.toHaveBeenCalled();
      expect(writeRecap).not.toHaveBeenCalled();
      // session-end is the only one that touches the store
      expect(store.has('s10')).toBe(true);
    });
  });

  describe('Criterion 11: session-end cleanup', () => {
    it('removes the session entry from the store', () => {
      const subscriber = createArchRecapSubscriber(deps);
      store.set('s11', { baseRef: 'SHA_TO_DELETE', cwd: '/repo' });
      expect(store.has('s11')).toBe(true);

      const event = makeEvent('session-end', 's11', {});
      subscriber(event);

      // Cleanup is synchronous, no deferral needed
      expect(defer).not.toHaveBeenCalled();
      expect(store.has('s11')).toBe(false);
    });
  });
});
