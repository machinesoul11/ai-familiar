import { describe, it, expect, vi } from 'vitest';
import { createPullRecap, NO_RECAP_LINE } from '../src/pullRecap.js';
import type { RecapSnapshot } from '../src/recapSnapshot.js';
import type { SpokenMessage } from '../src/channel.js';

describe('pullRecap onSpoken seam', () => {
  const presentSnapshot: RecapSnapshot = {
    v: 1,
    summary: {
      kind: 'arch-summary',
      modules: ['a'],
      newCouplings: [],
      protectedHits: [],
      violations: []
    } as any,
    finalMessage: 'Did the thing.'
  };

  it('1. Present snapshot: onSpoken is called with the same message as dispatch audio', () => {
    const loadSnapshot = vi.fn().mockReturnValue(presentSnapshot);
    const dispatch = vi.fn();
    const onSpoken = vi.fn();
    const pull = createPullRecap({ loadSnapshot, dispatch, onSpoken });

    pull();

    expect(onSpoken).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('audio', expect.any(Object));

    const dispatchedMsg = dispatch.mock.calls.find(call => call[0] === 'audio')?.[1];
    const onSpokenMsg = onSpoken.mock.calls[0][0];

    expect(onSpokenMsg).toEqual(dispatchedMsg);
    expect(onSpokenMsg.kind).toBe('spoken');
  });

  it('2. Null snapshot: onSpoken is called with NO_RECAP_LINE', () => {
    const loadSnapshot = vi.fn().mockReturnValue(null);
    const dispatch = vi.fn();
    const onSpoken = vi.fn();
    const pull = createPullRecap({ loadSnapshot, dispatch, onSpoken });

    pull();

    const expectedMessage: SpokenMessage = { kind: 'spoken', text: NO_RECAP_LINE };
    expect(onSpoken).toHaveBeenCalledWith(expectedMessage);
    expect(dispatch).toHaveBeenCalledWith('audio', expectedMessage);
  });

  it('3. onSpoken optional — present snapshot: pull() does not throw and dispatch is still called', () => {
    const loadSnapshot = vi.fn().mockReturnValue(presentSnapshot);
    const dispatch = vi.fn();
    const pull = createPullRecap({ loadSnapshot, dispatch });

    expect(() => pull()).not.toThrow();
    expect(dispatch).toHaveBeenCalledWith('audio', expect.objectContaining({ kind: 'spoken' }));
  });

  it('4. onSpoken optional — null snapshot: pull() does not throw and dispatch is still called', () => {
    const loadSnapshot = vi.fn().mockReturnValue(null);
    const dispatch = vi.fn();
    const pull = createPullRecap({ loadSnapshot, dispatch });

    expect(() => pull()).not.toThrow();
    expect(dispatch).toHaveBeenCalledWith('audio', { kind: 'spoken', text: NO_RECAP_LINE });
  });

  it('5. dispatch is NOT replaced by onSpoken', () => {
    const loadSnapshot = vi.fn().mockReturnValue(presentSnapshot);
    const dispatch = vi.fn();
    const onSpoken = vi.fn();
    const pull = createPullRecap({ loadSnapshot, dispatch, onSpoken });

    pull();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(onSpoken).toHaveBeenCalledTimes(1);
  });

  it('6. No dedup: calling pull twice calls onSpoken twice', () => {
    const loadSnapshot = vi.fn().mockReturnValue(presentSnapshot);
    const dispatch = vi.fn();
    const onSpoken = vi.fn();
    const pull = createPullRecap({ loadSnapshot, dispatch, onSpoken });

    pull();
    pull();

    expect(onSpoken).toHaveBeenCalledTimes(2);
  });
});
