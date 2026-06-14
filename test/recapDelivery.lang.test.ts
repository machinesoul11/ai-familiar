import { describe, it, expect, vi } from 'vitest';
import { createRecapDelivery } from '../src/recapDelivery.js';
import type { ArchSummary } from '../src/summary.js';

function buildSummary(v: number, p: number, m: number, c: number): ArchSummary {
  return {
    kind: 'arch-summary',
    violations: Array(v).fill(1),
    protectedHits: Array(p).fill(1),
    modules: Array(m).fill(1),
    newCouplings: Array(c).fill(1),
  };
}

describe('recapDelivery (language additions)', () => {
  it('AC12: Threads lang into shapeRecap and dispatches "spoken" to "notification"', () => {
    const dispatch = vi.fn();
    const deliverRecap = createRecapDelivery(dispatch, 'es');
    
    const summary = buildSummary(1, 0, 2, 0);
    // Vector E1 (es): 'Ejecución finalizada: 1 violación de límite, 2 módulos cambiados. 1 subagente finalizado.'
    deliverRecap(summary, 'Gist ignored', 1);
    
    expect(dispatch).toHaveBeenCalledWith('notification', {
      kind: 'spoken',
      text: 'Ejecución finalizada: 1 violación de límite, 2 módulos cambiados. 1 subagente finalizado.'
    });
  });

  it('AC12: Default lang="en" maintains existing behavior', () => {
    const dispatch1 = vi.fn();
    const deliverRecapEnExplicit = createRecapDelivery(dispatch1, 'en');
    
    const dispatch2 = vi.fn();
    const deliverRecapDefault = createRecapDelivery(dispatch2);

    const summary = buildSummary(0, 0, 3, 0);
    
    deliverRecapEnExplicit(summary, 'English gist', 2);
    deliverRecapDefault(summary, 'English gist', 2);
    
    expect(dispatch1.mock.calls).toEqual(dispatch2.mock.calls);
    expect(dispatch1).toHaveBeenCalled();
  });
});
