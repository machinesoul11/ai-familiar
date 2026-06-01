import { describe, it, expect } from 'vitest';
import { buildArchSummary } from '../src/summary.js';
import { modulesTouched } from '../src/diff.js';
import { importGraphDelta } from '../src/imports.js';
import { evaluateManifest } from '../src/manifest.js';

/**
 * CONTRACT CONCERNS:
 * 1. Criterion 4 and 8 mention sorting and "whatever the sub-analyzers guarantee". 
 *    The contract specifies that 2.4 performs NO re-sorting. I will assert that 
 *    the order returned by the sub-analyzers is preserved exactly.
 * 2. The contract is silent on what happens if 'files' and 'contents' are 
 *    inconsistent (e.g. different paths). Per "Deferred" section, 2.4 trusts 
 *    its inputs, so I will not test for defensive reconciliation of mismatches.
 */

describe('buildArchSummary', () => {
  // Criterion 1: kind discriminant
  // Criterion 9: Totality (empty inputs)
  it('returns a valid ArchSummary with kind "arch-summary" even for empty inputs', () => {
    const input = {
      files: [],
      contents: [],
      manifest: {}
    };

    const result = buildArchSummary(input);

    expect(result.kind).toBe('arch-summary');
    expect(result).toStrictEqual({
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    });
  });

  // Criterion 2, 3, 4: Faithful assembly of sub-analyzer outputs
  describe('faithful assembly', () => {
    const files = [
      { status: 'modified' as const, path: 'src/bridge.ts' },
      { status: 'added' as const, path: 'src/new-feature/core.ts' }
    ];
    const contents = [
      {
        path: 'src/bridge.ts',
        before: "import { x } from './bus.js';",
        after: "import { x } from './bus.js';\nimport { y } from './new-feature/core.js';"
      },
      {
        path: 'src/new-feature/core.ts',
        before: '',
        after: "export const y = 1;"
      }
    ];
    const manifest = {
      protected: ['src/bridge.ts'],
      separate: [{ from: 'src', to: 'src/new-feature', name: 'no-leak-to-features' }]
    };

    it('matches modulesTouched(files) output exactly', () => {
      const result = buildArchSummary({ files, contents, manifest });
      expect(result.modules).toStrictEqual(modulesTouched(files));
    });

    it('matches importGraphDelta(contents) output exactly', () => {
      const result = buildArchSummary({ files, contents, manifest });
      expect(result.newCouplings).toStrictEqual(importGraphDelta(contents));
    });

    it('matches evaluateManifest output when given derived couplings', () => {
      const result = buildArchSummary({ files, contents, manifest });
      const couplings = importGraphDelta(contents);
      const evaluation = evaluateManifest(manifest, { files, couplings });
      
      expect(result.protectedHits).toStrictEqual(evaluation.protectedHits);
      expect(result.violations).toStrictEqual(evaluation.violations);
    });
  });

  // Criterion 4: COUPLINGS PIPED INTO THE MANIFEST EVALUATION (Seam-critical)
  it('pipes derived couplings from contents into violations judging', () => {
    const files = [
      { status: 'added' as const, path: 'src/a/file.ts' }
    ];
    // This content creates a cross-module coupling src/a -> src/b
    const contents = [
      {
        path: 'src/a/file.ts',
        before: '',
        after: "import { b } from '../b/file.js';"
      }
    ];
    // Manifest forbids src/a -> src/b
    const manifest = {
      separate: [{ from: 'src/a', to: 'src/b', name: 'forbidden-coupling' }]
    };

    const result = buildArchSummary({ files, contents, manifest });

    // The violation MUST appear because the coupling derived from 'contents' 
    // was fed into evaluateManifest.
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      fromModule: 'src/a',
      toModule: 'src/b',
      fromFile: 'src/a/file.ts',
      rule: { from: 'src/a', to: 'src/b', name: 'forbidden-coupling' }
    });
  });

  // Criterion 5: protectedHits come from files (status/rename aware)
  describe('protectedHits handling', () => {
    it('detects hits on renamed files via oldPath', () => {
      const files = [
        { status: 'renamed' as const, path: 'src/new-name.ts', oldPath: 'src/protected-zone/file.ts' }
      ];
      const contents = [
        { path: 'src/new-name.ts', before: '/* old */', after: '/* new */' }
      ];
      const manifest = {
        protected: ['src/protected-zone']
      };

      const result = buildArchSummary({ files, contents, manifest });

      expect(result.protectedHits).toHaveLength(1);
      expect(result.protectedHits[0]).toMatchObject({
        path: 'src/new-name.ts',
        status: 'renamed',
        pattern: 'src/protected-zone'
      });
    });

    it('detects hits on renamed files via current path', () => {
      const files = [
        { status: 'renamed' as const, path: 'src/protected-zone/new-file.ts', oldPath: 'src/old-name.ts' }
      ];
      const contents = [
        { path: 'src/protected-zone/new-file.ts', before: '/* old */', after: '/* new */' }
      ];
      const manifest = {
        protected: ['src/protected-zone']
      };

      const result = buildArchSummary({ files, contents, manifest });

      expect(result.protectedHits).toHaveLength(1);
      expect(result.protectedHits[0].path).toBe('src/protected-zone/new-file.ts');
    });
  });

  // Criterion 6: Manifest omitted ≡ {}
  describe('manifest omission', () => {
    const files = [{ status: 'modified' as const, path: 'src/protected.ts' }];
    const contents = [{ path: 'src/protected.ts', before: 'import "x"', after: 'import "y"' }];
    const manifestWithRules = { protected: ['src/protected.ts'] };

    it('yields empty hits/violations when manifest is omitted', () => {
      const result = buildArchSummary({ files, contents });
      expect(result.protectedHits).toStrictEqual([]);
      expect(result.violations).toStrictEqual([]);
      // Modules and couplings should still be analyzed
      expect(result.modules).not.toHaveLength(0);
    });

    it('yields empty hits/violations when manifest is empty object', () => {
      const result = buildArchSummary({ files, contents, manifest: {} });
      expect(result.protectedHits).toStrictEqual([]);
      expect(result.violations).toStrictEqual([]);
    });
  });

  // Criterion 7, 8: No extra fields / No re-sort
  it('preserves sub-analyzer field set and ordering exactly (no extra fields, no re-sort)', () => {
    // We use inputs that might produce multiple results to verify order.
    // modulesTouched sorts by module asc.
    // importGraphDelta sorts by fromFile asc, then toModule asc.
    const files = [
      { status: 'added' as const, path: 'src/z/file.ts' },
      { status: 'added' as const, path: 'src/a/file.ts' }
    ];
    const contents = [
      { path: 'src/a/file.ts', before: '', after: "import { b } from '../b/file.js'; import { c } from '../c/file.js';" },
      { path: 'src/z/file.ts', before: '', after: "import { a } from '../a/file.js';" }
    ];
    
    const result = buildArchSummary({ files, contents });

    // 1. Exact shape check (Criterion 7)
    const keys = Object.keys(result).sort();
    expect(keys).toStrictEqual(['kind', 'modules', 'newCouplings', 'protectedHits', 'violations'].sort());

    // 2. Order check (Criterion 8)
    // modules: 'src/a' should come before 'src/z'
    expect(result.modules[0].module).toBe('src/a');
    expect(result.modules[1].module).toBe('src/z');

    // newCouplings: 'src/a/file.ts' -> 'src/b', 'src/a/file.ts' -> 'src/c', 'src/z/file.ts' -> 'src/a'
    expect(result.newCouplings[0].fromFile).toBe('src/a/file.ts');
    expect(result.newCouplings[0].toModule).toBe('src/b');
    expect(result.newCouplings[1].fromFile).toBe('src/a/file.ts');
    expect(result.newCouplings[1].toModule).toBe('src/c');
    expect(result.newCouplings[2].fromFile).toBe('src/z/file.ts');
  });

  // Criterion 10: Determinism
  it('is deterministic (identical input produces identical output)', () => {
    const input = {
      files: [{ status: 'modified' as const, path: 'src/router.ts' }],
      contents: [{ path: 'src/router.ts', before: '', after: 'import "./x.js"' }],
      manifest: { protected: ['src/router.ts'] }
    };

    const run1 = buildArchSummary(input);
    const run2 = buildArchSummary(input);

    expect(run1).toStrictEqual(run2);
  });

  // Criterion 11: Worked example end-to-end
  it('reproduces the worked example from the contract exactly', () => {
    const input = {
      files: [
        { status: 'modified' as const, path: 'src/router.ts' },
        { status: 'added' as const, path: 'src/avatar/spine.ts' }
      ],
      contents: [
        {
          path: 'src/router.ts',
          before: "import { x } from './normalize.js';",
          after: "import { x } from './normalize.js';\nimport { draw } from './avatar/spine.js';"
        },
        { path: 'src/avatar/spine.ts', before: '', after: "import { z } from 'zod';" }
      ],
      manifest: {
        protected: ['src/router.ts'],
        separate: [{ from: 'src', to: 'src/avatar', name: 'core-no-avatar' }]
      }
    };

    const expected = {
      kind: 'arch-summary',
      modules: [
        { module: 'src', files: [{ status: 'modified', path: 'src/router.ts' }], added: 0, modified: 1, deleted: 0, renamed: 0 },
        { module: 'src/avatar', files: [{ status: 'added', path: 'src/avatar/spine.ts' }], added: 1, modified: 0, deleted: 0, renamed: 0 }
      ],
      newCouplings: [
        { fromModule: 'src', toModule: 'src/avatar', fromFile: 'src/router.ts', specifier: './avatar/spine.js' }
      ],
      protectedHits: [
        { path: 'src/router.ts', status: 'modified', pattern: 'src/router.ts' }
      ],
      violations: [
        {
          fromModule: 'src', toModule: 'src/avatar', fromFile: 'src/router.ts', specifier: './avatar/spine.js',
          rule: { from: 'src', to: 'src/avatar', name: 'core-no-avatar' }
        }
      ]
    };

    expect(buildArchSummary(input)).toStrictEqual(expected);
  });
});
