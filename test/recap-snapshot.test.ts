import { describe, it, expect } from 'vitest';
import { serializeSnapshot, parseSnapshot } from '../src/recapSnapshot.js';
import type { RecapSnapshot } from '../src/recapSnapshot.js';
import type { ArchSummary } from '../src/summary.js';

describe('recapSnapshot.ts', () => {
  const fullSummary: ArchSummary = {
    kind: 'arch-summary',
    modules: [{ module: 'src/foo', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 }],
    newCouplings: [{ fromModule: 'a', toModule: 'b', fromFile: 'a.ts', specifier: 'b' }],
    protectedHits: [{ path: 'x', status: 'modified', pattern: '.*' }],
    violations: [{ fromModule: 'a', toModule: 'b', fromFile: 'a.ts', specifier: 'b', rule: { from: 'a', to: 'b' } }]
  };

  it('AC 1: serializeSnapshot -> parseSnapshot round-trips a snapshot with non-empty arrays and a string finalMessage', () => {
    const snapshot: RecapSnapshot = {
      v: 1,
      summary: fullSummary,
      finalMessage: 'Test message'
    };
    const serialized = serializeSnapshot(snapshot);
    const parsed = parseSnapshot(serialized);
    expect(parsed).toEqual(snapshot);
  });

  it('AC 2: round-trips finalMessage === null', () => {
    const snapshot: RecapSnapshot = {
      v: 1,
      summary: fullSummary,
      finalMessage: null
    };
    const serialized = serializeSnapshot(snapshot);
    const parsed = parseSnapshot(serialized);
    expect(parsed).toEqual(snapshot);
  });

  it('AC 3: parseSnapshot(null) returns null', () => {
    expect(parseSnapshot(null)).toBeNull();
  });

  it('AC 4: parseSnapshot("not json {") returns null', () => {
    expect(parseSnapshot('not json {')).toBeNull();
  });

  it('AC 5: parseSnapshot of JSON array and primitives returns null', () => {
    expect(parseSnapshot('[]')).toBeNull();
    expect(parseSnapshot('5')).toBeNull();
    expect(parseSnapshot('"x"')).toBeNull();
    expect(parseSnapshot('true')).toBeNull();
    expect(parseSnapshot('null')).toBeNull();
  });

  it('AC 6: parseSnapshot of object with v !== 1 returns null', () => {
    expect(parseSnapshot(JSON.stringify({ v: 2, summary: fullSummary, finalMessage: 'msg' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ summary: fullSummary, finalMessage: 'msg' }))).toBeNull();
  });

  it('AC 7: parseSnapshot where summary is missing, not object, or kind !== "arch-summary" returns null', () => {
    expect(parseSnapshot(JSON.stringify({ v: 1, finalMessage: 'msg' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 1, summary: 'string', finalMessage: 'msg' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 1, summary: { kind: 'wrong', modules: [], newCouplings: [], protectedHits: [], violations: [] }, finalMessage: 'msg' }))).toBeNull();
  });

  it('AC 8: parseSnapshot where one of the 4 arrays is not an array returns null', () => {
    const base = { v: 1, finalMessage: 'msg', summary: { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] } };
    expect(parseSnapshot(JSON.stringify({ ...base, summary: { ...base.summary, modules: 'not array' } }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base, summary: { ...base.summary, newCouplings: {} } }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base, summary: { ...base.summary, protectedHits: null } }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base, summary: { ...base.summary, violations: 5 } }))).toBeNull();
  });

  it('AC 9: parseSnapshot coerces non-string finalMessage to null', () => {
    const rawNum = JSON.stringify({ v: 1, summary: fullSummary, finalMessage: 123 });
    const parsedNum = parseSnapshot(rawNum);
    expect(parsedNum?.finalMessage).toBeNull();
    expect(parsedNum?.summary).toEqual(fullSummary);

    const rawObj = JSON.stringify({ v: 1, summary: fullSummary, finalMessage: {} });
    const parsedObj = parseSnapshot(rawObj);
    expect(parsedObj?.finalMessage).toBeNull();
    
    const rawAbsent = JSON.stringify({ v: 1, summary: fullSummary });
    const parsedAbsent = parseSnapshot(rawAbsent);
    expect(parsedAbsent?.finalMessage).toBeNull();
  });

  it('AC 10: returned summary preserves array contents (representative element survives)', () => {
    const snapshot: RecapSnapshot = { v: 1, summary: fullSummary, finalMessage: null };
    const parsed = parseSnapshot(serializeSnapshot(snapshot));
    expect(parsed?.summary.modules[0].module).toBe('src/foo');
    expect(parsed?.summary.violations[0].rule.from).toBe('a');
  });

  it('AC 11: serializeSnapshot is a string that JSON.parse reads to an object with v === 1', () => {
    const snapshot: RecapSnapshot = { v: 1, summary: fullSummary, finalMessage: null };
    const serialized = serializeSnapshot(snapshot);
    expect(typeof serialized).toBe('string');
    const reread = JSON.parse(serialized);
    expect(reread.v).toBe(1);
  });

  it('AC 12: totality - parseSnapshot never throws', () => {
    expect(() => parseSnapshot('')).not.toThrow();
    expect(() => parseSnapshot('{')).not.toThrow();
    expect(() => parseSnapshot('{"v":1}')).not.toThrow();
    expect(() => parseSnapshot('   ')).not.toThrow();
    expect(() => parseSnapshot('{"v":1,"summary":{}}')).not.toThrow();
    expect(parseSnapshot('')).toBeNull();
    expect(parseSnapshot('{')).toBeNull();
    expect(parseSnapshot('{"v":1}')).toBeNull();
    expect(parseSnapshot('   ')).toBeNull();
    expect(parseSnapshot('{"v":1,"summary":{}}')).toBeNull();
  });
});
