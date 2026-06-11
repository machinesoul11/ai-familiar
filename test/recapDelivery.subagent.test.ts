import { describe, it, expect, vi } from 'vitest';
import { createRecapDelivery } from '../src/recapDelivery.js';
import { shapeRecap } from '../src/shaper.js';

describe('recapDelivery with subagentCount', () => {
  it('AC11: forwards subagentCount to shaper and dispatches shaped line', () => {
    const dispatch = vi.fn();
    const deliver = createRecapDelivery(dispatch);

    const summary = { kind: 'arch-summary', modules: [], newCouplings: [], protectedHits: [], violations: [] } as any;

    deliver(summary, null, 5);
    const expectedLine5 = shapeRecap({ summary, finalMessage: null, subagentCount: 5 }).spokenLine;
    expect(dispatch).toHaveBeenCalledWith('notification', { kind: 'spoken', text: expectedLine5 });

    dispatch.mockClear();

    deliver(summary, 'Gist');
    const expectedLineNoCount = shapeRecap({ summary, finalMessage: 'Gist' }).spokenLine;
    expect(dispatch).toHaveBeenCalledWith('notification', { kind: 'spoken', text: expectedLineNoCount });
  });
});
