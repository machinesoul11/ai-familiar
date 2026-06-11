import { describe, it, expect, vi } from 'vitest';
import { createArchRecapSubscriber } from '../src/archRecap.js';

describe('archRecap subagent counting', () => {
  const makeDeps = () => ({
    captureBase: () => 'BASE',
    makeReader: () => ({
      diffNameStatus: () => null,
      listUntracked: () => [],
      showBlob: () => null,
      readWorking: () => null,
    }),
    writeRecap: vi.fn(),
    defer: (task: () => void) => task(),
    onRecap: vi.fn()
  });

  const sessionStartEvent = (sessionId: string) => ({
    kind: 'session-start',
    sessionId,
    raw: { payload: { cwd: '/test/dir' } }
  } as any);

  const subagentFinishedEvent = (sessionId: string) => ({
    kind: 'subagent-finished',
    sessionId,
    raw: { payload: {} }
  } as any);

  const runFinishedEvent = (sessionId: string) => ({
    kind: 'run-finished',
    sessionId,
    raw: { payload: {} }
  } as any);

  it('counts multiple subagent-finished events and passes to onRecap', () => {
    const deps = makeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    const sid = 'session1';

    subscriber(sessionStartEvent(sid));
    subscriber(subagentFinishedEvent(sid));
    subscriber(subagentFinishedEvent(sid));
    subscriber(subagentFinishedEvent(sid));
    
    subscriber(runFinishedEvent(sid));
    
    expect(deps.onRecap).toHaveBeenCalled();
    expect(deps.onRecap.mock.calls[0][2]).toBe(3);
  });

  it('passes 0 if no subagents finished', () => {
    const deps = makeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    const sid = 'session2';

    subscriber(sessionStartEvent(sid));
    
    subscriber(runFinishedEvent(sid));
    
    expect(deps.onRecap).toHaveBeenCalled();
    expect(deps.onRecap.mock.calls[0][2]).toBe(0);
  });

  it('resets the count per-run', () => {
    const deps = makeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    const sid = 'session3';

    subscriber(sessionStartEvent(sid));
    subscriber(subagentFinishedEvent(sid));
    subscriber(subagentFinishedEvent(sid));
    
    subscriber(runFinishedEvent(sid));
    expect(deps.onRecap.mock.calls[0][2]).toBe(2);

    // Second run in same session
    subscriber(subagentFinishedEvent(sid));
    subscriber(runFinishedEvent(sid));
    
    expect(deps.onRecap.mock.calls[1][2]).toBe(1);
  });

  it('isolates counts per session', () => {
    const deps = makeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    
    subscriber(sessionStartEvent('sidA'));
    subscriber(sessionStartEvent('sidB'));

    subscriber(subagentFinishedEvent('sidA'));
    subscriber(subagentFinishedEvent('sidB'));
    subscriber(subagentFinishedEvent('sidB'));

    subscriber(runFinishedEvent('sidA'));
    expect(deps.onRecap.mock.calls[0][2]).toBe(1);

    subscriber(runFinishedEvent('sidB'));
    expect(deps.onRecap.mock.calls[1][2]).toBe(2);
  });

  it('calls writeRecap unconditionally and does not throw', () => {
    const deps = makeDeps();
    const subscriber = createArchRecapSubscriber(deps);
    
    expect(() => {
      subscriber(sessionStartEvent('sidC'));
      subscriber(subagentFinishedEvent('sidC'));
      subscriber(runFinishedEvent('sidC'));
    }).not.toThrow();

    expect(deps.writeRecap).toHaveBeenCalled();
    expect(deps.onRecap).toHaveBeenCalled();
  });
});
