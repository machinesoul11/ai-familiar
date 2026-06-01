import { describe, it, expect } from 'vitest';
import { formatArchRecap } from '../src/recap.js';
import type { ArchSummary } from '../src/summary.js';

describe('formatArchRecap', () => {
  it('returns exactly the empty summary line when all arrays are empty', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    expect(formatArchRecap(summary)).toBe('No architectural changes detected.');
  });

  it('renders only the Modules section when other arrays are empty', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [
        { module: 'src', files: [], added: 2, modified: 0, deleted: 1, renamed: 0 },
        { module: 'src/core', files: [], added: 0, modified: 5, deleted: 0, renamed: 1 }
      ],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    const expected = [
      'Modules changed (2):',
      '  src: +2 ~0 -1 R0',
      '  src/core: +0 ~5 -0 R1'
    ].join('\n');
    expect(formatArchRecap(summary)).toBe(expected);
  });

  it('renders only the New couplings section when other arrays are empty', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [
        { fromModule: 'src', toModule: 'src/utils', fromFile: 'src/main.ts', specifier: './utils/math.js' },
        { fromModule: 'a', toModule: 'b', fromFile: 'a/index.ts', specifier: 'b' }
      ],
      protectedHits: [],
      violations: []
    };
    const expected = [
      'New cross-module coupling (2):',
      '  src/main.ts: src -> src/utils (./utils/math.js)',
      '  a/index.ts: a -> b (b)'
    ].join('\n');
    expect(formatArchRecap(summary)).toBe(expected);
  });

  it('renders only the Protected zones section when other arrays are empty', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [
        { path: 'src/config.ts', status: 'deleted', pattern: 'src/config.ts' },
        { path: 'lib/core.js', status: 'modified', pattern: 'lib/**/*.js' }
      ],
      violations: []
    };
    const expected = [
      'Protected zones touched (2):',
      '  src/config.ts [deleted] (matched src/config.ts)',
      '  lib/core.js [modified] (matched lib/**/*.js)'
    ].join('\n');
    expect(formatArchRecap(summary)).toBe(expected);
  });

  it('renders only the Violations section, handling named and unnamed rules', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: [
        { fromModule: 'ui', toModule: 'db', fromFile: 'ui/btn.ts', specifier: '../db/index.js', rule: { from: 'ui', to: 'db', name: 'ui-no-db' } },
        { fromModule: 'a', toModule: 'b', fromFile: 'a/x.ts', specifier: 'b', rule: { from: 'a', to: 'b' } },
        { fromModule: 'x', toModule: 'y', fromFile: 'x/index.ts', specifier: 'y', rule: { from: 'x', to: 'y', name: '' } }
      ]
    };
    const expected = [
      'Boundary violations (3):',
      '  ui/btn.ts: ui -> db violates ui-no-db',
      '  a/x.ts: a -> b violates a -> b',
      '  x/index.ts: x -> y violates x -> y'
    ].join('\n');
    expect(formatArchRecap(summary)).toBe(expected);
  });

  it('reproduces the worked example end-to-end with correct section order and joins', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [
        { module: 'src', files: [], added: 0, modified: 1, deleted: 0, renamed: 0 },
        { module: 'src/avatar', files: [], added: 1, modified: 0, deleted: 0, renamed: 0 }
      ],
      newCouplings: [
        { fromModule: 'src', toModule: 'src/avatar', fromFile: 'src/router.ts', specifier: './avatar/spine.js' }
      ],
      protectedHits: [
        { path: 'src/router.ts', status: 'modified', pattern: 'src/router.ts' }
      ],
      violations: [
        { fromModule: 'src', toModule: 'src/avatar', fromFile: 'src/router.ts', specifier: './avatar/spine.js', rule: { from: 'src', to: 'src/avatar', name: 'core-no-avatar' } }
      ]
    };
    
    const expected = [
      'Modules changed (2):',
      '  src: +0 ~1 -0 R0',
      '  src/avatar: +1 ~0 -0 R0',
      '',
      'New cross-module coupling (1):',
      '  src/router.ts: src -> src/avatar (./avatar/spine.js)',
      '',
      'Protected zones touched (1):',
      '  src/router.ts [modified] (matched src/router.ts)',
      '',
      'Boundary violations (1):',
      '  src/router.ts: src -> src/avatar violates core-no-avatar'
    ].join('\n');
    
    expect(formatArchRecap(summary)).toBe(expected);
  });

  it('is deterministic for identical summaries and does not throw', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [
        { module: 'src', files: [], added: 0, modified: 1, deleted: 0, renamed: 0 }
      ],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    
    const run1 = formatArchRecap(summary);
    const run2 = formatArchRecap(summary);
    
    expect(run1).toBe('Modules changed (1):\n  src: +0 ~1 -0 R0');
    expect(run1).toBe(run2);
  });
});
