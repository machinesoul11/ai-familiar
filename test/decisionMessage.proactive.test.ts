import { describe, it, expect } from 'vitest';
import { decisionMessage, RUN_STARTED_LINE } from '../src/decisionMessage.js';

describe('decisionMessage (proactive)', () => {
  it('returns spoken text for run-started reason', () => {
    const routed = { decision: { reason: 'run-started' } } as any;
    expect(decisionMessage(routed)).toEqual({
      kind: 'spoken',
      text: RUN_STARTED_LINE
    });
  });

  it('returns null for other specific reasons', () => {
    expect(decisionMessage({ decision: { reason: 'subagent-narrate' } } as any)).toBeNull();
    expect(decisionMessage({ decision: { reason: 'run-finished' } } as any)).toBeNull();
    expect(decisionMessage({ decision: { reason: 'subagent-progress' } } as any)).toBeNull();
    expect(decisionMessage({ decision: { reason: 'silent' } } as any)).toBeNull();
  });

  it('returns null for unknown arbitrary reason', () => {
    expect(decisionMessage({ decision: { reason: 'some-unknown-reason' } } as any)).toBeNull();
  });
});
