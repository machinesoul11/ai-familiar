import { describe, it, expect } from 'vitest';
import { createArchRecapSubscriber } from '../src/archRecap.js';
import type { ArchSummary } from '../src/summary.js';

describe('archRecap finalMessage plumbing', () => {
  function makeFakeDeps() {
    let deferredTask: (() => void) | null = null;
    const store = new Map();
    const recapCalls: { summary: ArchSummary, finalMessage: string | null }[] = [];
    const readTranscriptCalls: string[] = [];
    let writeRecapCount = 0;
    let mockTranscriptData: string | null = null;
    let readTranscriptShouldExist = true;
    let onRecapShouldExist = true;

    const baseDeps = {
      captureBase: () => 'HEAD',
      makeReader: () => ({
        diffNameStatus: () => null,
        listUntracked: () => [],
        showBlob: () => null,
        readWorking: () => null
      }) as any,
      writeRecap: () => { writeRecapCount++; },
      defer: (task: () => void) => { deferredTask = task; },
      store
    };

    return {
      get deps() {
        return {
          ...baseDeps,
          onRecap: onRecapShouldExist ? ((s: ArchSummary, f: string | null) => recapCalls.push({ summary: s, finalMessage: f })) : undefined,
          readTranscript: readTranscriptShouldExist ? ((path: string) => {
            readTranscriptCalls.push(path);
            return mockTranscriptData;
          }) : undefined
        };
      },
      store,
      recapCalls,
      readTranscriptCalls,
      get writeRecapCount() { return writeRecapCount; },
      get deferredTask() { return deferredTask; },
      setMockTranscriptData(data: string | null) { mockTranscriptData = data; },
      removeReadTranscript() { readTranscriptShouldExist = false; },
      removeOnRecap() { onRecapShouldExist = false; },
      runDeferred() {
        if (deferredTask) {
          deferredTask();
        }
      }
    };
  }

  function makeRunFinishedEvent(sessionId: string, transcriptPath?: string) {
    const payload: any = {};
    if (transcriptPath !== undefined) {
      payload.transcript_path = transcriptPath;
    }
    return {
      kind: 'run-finished',
      sessionId,
      v: 1,
      hook: 'Stop',
      ts: '0',
      raw: {
        payload
      }
    } as any;
  }

  // AC19 and AC20
  it("reads transcript and passes extracted message to onRecap", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' });
    
    fakes.setMockTranscriptData(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] } }));
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    subscriber(makeRunFinishedEvent('s1', '/path/to/t.jsonl'));
    
    fakes.runDeferred();
    
    expect(fakes.readTranscriptCalls).toEqual(['/path/to/t.jsonl']);
    expect(fakes.recapCalls.length).toBe(1);
    expect(fakes.recapCalls[0].summary.kind).toBe('arch-summary');
    expect(fakes.recapCalls[0].finalMessage).toBe('All done.');
  });

  // AC21
  it("passes null if no transcript_path is in the payload or is empty string", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' });
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    
    subscriber(makeRunFinishedEvent('s1')); // no path
    fakes.runDeferred();
    expect(fakes.readTranscriptCalls.length).toBe(0);
    expect(fakes.recapCalls[0].finalMessage).toBeNull();
    
    subscriber(makeRunFinishedEvent('s1', '')); // empty path
    fakes.runDeferred();
    expect(fakes.readTranscriptCalls.length).toBe(0);
    expect(fakes.recapCalls[1].finalMessage).toBeNull();
  });

  // AC22
  it("passes null if readTranscript dep is absent", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' });
    fakes.removeReadTranscript();
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    subscriber(makeRunFinishedEvent('s1', '/path/to/t.jsonl'));
    
    fakes.runDeferred();
    expect(fakes.recapCalls[0].finalMessage).toBeNull();
  });

  // AC23
  it("passes null if readTranscript returns null (unreadable file)", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' });
    fakes.setMockTranscriptData(null);
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    subscriber(makeRunFinishedEvent('s1', '/path/to/t.jsonl'));
    
    fakes.runDeferred();
    expect(fakes.recapCalls[0].finalMessage).toBeNull();
  });

  // AC24
  it("passes null if readTranscript returns JSONL with no assistant text", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' });
    fakes.setMockTranscriptData(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }));
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    subscriber(makeRunFinishedEvent('s1', '/path/to/t.jsonl'));
    
    fakes.runDeferred();
    expect(fakes.recapCalls[0].finalMessage).toBeNull();
  });

  // AC25
  it("executes the transcript read inside the deferred task and only if onRecap is set", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' });
    fakes.setMockTranscriptData(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }));
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    subscriber(makeRunFinishedEvent('s1', '/path/to/t.jsonl'));
    
    // Before running deferred: no read, no recap
    expect(fakes.readTranscriptCalls.length).toBe(0);
    expect(fakes.recapCalls.length).toBe(0);
    
    fakes.runDeferred();
    
    // After running deferred: read and recap happened
    expect(fakes.readTranscriptCalls.length).toBe(1);
    expect(fakes.recapCalls.length).toBe(1);
    expect(fakes.writeRecapCount).toBe(1);
    
    // Now with no onRecap
    const fakes2 = makeFakeDeps();
    fakes2.store.set('s2', { baseRef: 'HEAD', cwd: '/x' });
    fakes2.removeOnRecap();
    const subscriber2 = createArchRecapSubscriber(fakes2.deps);
    subscriber2(makeRunFinishedEvent('s2', '/path/to/t.jsonl'));
    
    fakes2.runDeferred();
    
    expect(fakes2.readTranscriptCalls.length).toBe(0);
    expect(fakes2.writeRecapCount).toBe(1); // writeRecap still called (3.4a behaviour preserved)
  });

  // AC26
  it("does not call onRecap for other events or missing base", () => {
    const fakes = makeFakeDeps();
    fakes.store.set('s1', { baseRef: 'HEAD', cwd: '/x' }); // known base for s1
    // s2 has no base
    
    const subscriber = createArchRecapSubscriber(fakes.deps);
    
    const events = [
      { kind: 'session-start', sessionId: 's1' },
      { kind: 'session-end', sessionId: 's1' },
      { kind: 'subagent-finished', sessionId: 's1' },
      { kind: 'notification', sessionId: 's1' },
      { kind: 'unknown', sessionId: 's1' },
      makeRunFinishedEvent('s2', '/path/to/t.jsonl') // no base recorded for s2
    ];
    
    for (const event of events) {
      subscriber(event as any);
      fakes.runDeferred();
    }
    
    expect(fakes.recapCalls.length).toBe(0);
  });
});
