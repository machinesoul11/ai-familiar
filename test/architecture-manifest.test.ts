import { describe, it, expect } from 'vitest';
import {
  matchesPattern,
  protectedZoneHits,
  boundaryViolations,
  evaluateManifest,
  type ArchitectureManifest,
  type SeparationRule,
} from '../src/manifest.js';
import type { ChangedFile } from '../src/diff.js';
import type { NewCoupling } from '../src/imports.js';

describe('matchesPattern', () => {
  it('1. exact file: matches perfectly equal strings', () => {
    expect(matchesPattern('src/daemon.ts', 'src/daemon.ts')).toBe(true);
  });

  it('2. subtree & self: matches self and segment subtrees', () => {
    expect(matchesPattern('src/payment', 'src/payment')).toBe(true);
    expect(matchesPattern('src/payment/charge.ts', 'src/payment')).toBe(true);
  });

  it('3. segment boundary (sibling prefix excluded): avoids prefix mismatch', () => {
    expect(matchesPattern('src/payment-utils.ts', 'src/payment')).toBe(false);
  });

  it('4. ancestor excluded: ancestor does not match descendant pattern', () => {
    expect(matchesPattern('src/payment', 'src/payment/charge.ts')).toBe(false);
    expect(matchesPattern('src', 'src/payment')).toBe(false);
  });

  it('5. trailing slash ignored: a single trailing slash in pattern is dropped', () => {
    expect(matchesPattern('src/payment/x.ts', 'src/payment/')).toBe(true);
  });

  it('6. empty/totality: empty pattern matches nothing and function never throws', () => {
    expect(matchesPattern('src/a.ts', '')).toBe(false);
    expect(matchesPattern('', '')).toBe(false);

    // Totality guarantees no throws for these cases too
    expect(() => matchesPattern('', 'src')).not.toThrow();
  });
});

describe('protectedZoneHits', () => {
  it('7. basic hit: modified file under protected dir yields a hit, others yield nothing', () => {
    const manifest: ArchitectureManifest = { protected: ['src/daemon'] };
    const files: ChangedFile[] = [
      { status: 'modified', path: 'src/daemon/index.ts' },
      { status: 'added', path: 'src/other.ts' },
    ];
    const hits = protectedZoneHits(manifest, files);
    expect(hits).toStrictEqual([
      {
        path: 'src/daemon/index.ts',
        status: 'modified',
        pattern: 'src/daemon',
      },
    ]);
  });

  it('8. exact-file pattern: protected pattern equal to changed file path matches', () => {
    const manifest: ArchitectureManifest = { protected: ['src/ledger.ts'] };
    const files: ChangedFile[] = [{ status: 'modified', path: 'src/ledger.ts' }];
    const hits = protectedZoneHits(manifest, files);
    expect(hits).toStrictEqual([
      {
        path: 'src/ledger.ts',
        status: 'modified',
        pattern: 'src/ledger.ts',
      },
    ]);
  });

  it('9. renamed via oldPath: handles files moved into or out of protected zones', () => {
    const manifest: ArchitectureManifest = { protected: ['src/daemon', 'src/legacy'] };
    const files: ChangedFile[] = [
      // Moves out of a protected zone (`oldPath` matches)
      { status: 'renamed', path: 'src/new-daemon.ts', oldPath: 'src/daemon/old.ts' },
      // Moves into a protected zone (`path` matches)
      { status: 'renamed', path: 'src/legacy/new.ts', oldPath: 'src/unprotected.ts' },
    ];
    const hits = protectedZoneHits(manifest, files);
    expect(hits).toStrictEqual([
      {
        path: 'src/legacy/new.ts',
        status: 'renamed',
        pattern: 'src/legacy',
      },
      {
        path: 'src/new-daemon.ts',
        status: 'renamed',
        pattern: 'src/daemon',
      },
    ]);
  });

  it('10. representative pattern: smallest pattern (UTF-16) wins when multiple match', () => {
    const manifest: ArchitectureManifest = {
      protected: ['src/daemon/server.ts', 'src', 'src/daemon'],
    };
    const files: ChangedFile[] = [{ status: 'modified', path: 'src/daemon/server.ts' }];
    const hits = protectedZoneHits(manifest, files);
    // 'src' < 'src/daemon' < 'src/daemon/server.ts'
    expect(hits).toStrictEqual([
      {
        path: 'src/daemon/server.ts',
        status: 'modified',
        pattern: 'src',
      },
    ]);
  });

  it('11. totality & skip: empty patterns are skipped, missing arrays handled safely', () => {
    // Missing manifest.protected
    expect(protectedZoneHits({}, [{ status: 'added', path: 'src/a.ts' }])).toStrictEqual([]);
    // Empty strings are skipped
    expect(
      protectedZoneHits({ protected: ['', '/'] }, [{ status: 'added', path: 'src/a.ts' }])
    ).toStrictEqual([]);
    // Empty input array
    expect(protectedZoneHits({ protected: ['src'] }, [])).toStrictEqual([]);
  });

  it('12. sort: ordered by path asc, then pattern asc, independent of input order', () => {
    const manifest: ArchitectureManifest = { protected: ['src/a', 'src/b'] };
    const files: ChangedFile[] = [
      { status: 'modified', path: 'src/b/2.ts' },
      { status: 'modified', path: 'src/a/1.ts' },
    ];
    const hits = protectedZoneHits(manifest, files);
    expect(hits).toStrictEqual([
      { path: 'src/a/1.ts', status: 'modified', pattern: 'src/a' },
      { path: 'src/b/2.ts', status: 'modified', pattern: 'src/b' },
    ]);
  });
});

describe('boundaryViolations', () => {
  it('13. basic violation: coupling matches from/to and yields violation', () => {
    const rule: SeparationRule = { from: 'src/ui', to: 'src/db', name: 'ui-no-db' };
    const manifest: ArchitectureManifest = { separate: [rule] };
    const couplings: NewCoupling[] = [
      {
        fromModule: 'src/ui',
        toModule: 'src/db',
        fromFile: 'src/ui/component.ts',
        specifier: '../db/index.js',
      },
    ];
    const violations = boundaryViolations(manifest, couplings);
    expect(violations).toStrictEqual([
      {
        fromModule: 'src/ui',
        toModule: 'src/db',
        fromFile: 'src/ui/component.ts',
        specifier: '../db/index.js',
        rule,
      },
    ]);
  });

  it('14. subtree rule: rule flags coupling across deep subdirectories', () => {
    const rule: SeparationRule = { from: 'src', to: 'lib' };
    const manifest: ArchitectureManifest = { separate: [rule] };
    const couplings: NewCoupling[] = [
      {
        fromModule: 'src/bin',
        toModule: 'lib',
        fromFile: 'src/bin/cli.ts',
        specifier: '../../lib/util.js',
      },
    ];
    const violations = boundaryViolations(manifest, couplings);
    expect(violations).toStrictEqual([
      {
        fromModule: 'src/bin',
        toModule: 'lib',
        fromFile: 'src/bin/cli.ts',
        specifier: '../../lib/util.js',
        rule,
      },
    ]);
  });

  it('15. direction matters: reverse coupling is not a violation', () => {
    const manifest: ArchitectureManifest = { separate: [{ from: 'src/ui', to: 'src/db' }] };
    const couplings: NewCoupling[] = [
      {
        fromModule: 'src/db',
        toModule: 'src/ui',
        fromFile: 'src/db/helper.ts',
        specifier: '../ui/types.js',
      },
    ];
    expect(boundaryViolations(manifest, couplings)).toStrictEqual([]);
  });

  it('16. non-match excluded: coupling matching no rule yields nothing', () => {
    const manifest: ArchitectureManifest = { separate: [{ from: 'src/ui', to: 'src/db' }] };
    const couplings: NewCoupling[] = [
      {
        fromModule: 'src/ui',
        toModule: 'src/api',
        fromFile: 'src/ui/component.ts',
        specifier: '../api/index.js',
      },
    ];
    expect(boundaryViolations(manifest, couplings)).toStrictEqual([]);
  });

  it('17. multiple rules: coupling matching two rules yields two violations', () => {
    const rule1: SeparationRule = { from: 'src/ui', to: 'src/db' };
    const rule2: SeparationRule = { from: 'src', to: 'src/db', name: 'core-no-db' };
    const manifest: ArchitectureManifest = { separate: [rule1, rule2] };
    const couplings: NewCoupling[] = [
      {
        fromModule: 'src/ui',
        toModule: 'src/db',
        fromFile: 'src/ui/component.ts',
        specifier: '../db/index.js',
      },
    ];
    const violations = boundaryViolations(manifest, couplings);
    expect(violations).toHaveLength(2);
    // order might depend on sort, but both rules should be there
    expect(violations).toContainEqual({
      fromModule: 'src/ui',
      toModule: 'src/db',
      fromFile: 'src/ui/component.ts',
      specifier: '../db/index.js',
      rule: rule2, // from 'src' comes before 'src/ui'
    });
    expect(violations).toContainEqual({
      fromModule: 'src/ui',
      toModule: 'src/db',
      fromFile: 'src/ui/component.ts',
      specifier: '../db/index.js',
      rule: rule1,
    });
  });

  it('18. totality & skip: missing arrays or empty from/to handled safely', () => {
    const couplings: NewCoupling[] = [
      { fromModule: 'src/a', toModule: 'src/b', fromFile: 'src/a/1.ts', specifier: '../b/1.js' },
    ];
    // Missing separate array
    expect(boundaryViolations({}, couplings)).toStrictEqual([]);
    // Empty from or to are skipped
    expect(
      boundaryViolations({ separate: [{ from: '', to: 'src/b' }, { from: 'src/a', to: '' }] }, couplings)
    ).toStrictEqual([]);
    // Empty couplings
    expect(boundaryViolations({ separate: [{ from: 'src/a', to: 'src/b' }] }, [])).toStrictEqual([]);
  });

  it('19. sort: ordered by fromFile, toModule, rule.from, rule.to independent of input', () => {
    const ruleZ: SeparationRule = { from: 'z', to: 'y' };
    const ruleA: SeparationRule = { from: 'a', to: 'b' };
    const manifest: ArchitectureManifest = { separate: [ruleZ, ruleA] };
    const couplings: NewCoupling[] = [
      { fromModule: 'z', toModule: 'y', fromFile: 'src/z/2.ts', specifier: 'y' },
      { fromModule: 'a', toModule: 'b', fromFile: 'src/a/1.ts', specifier: 'b' },
    ];
    const violations = boundaryViolations(manifest, couplings);
    expect(violations).toStrictEqual([
      { fromModule: 'a', toModule: 'b', fromFile: 'src/a/1.ts', specifier: 'b', rule: ruleA },
      { fromModule: 'z', toModule: 'y', fromFile: 'src/z/2.ts', specifier: 'y', rule: ruleZ },
    ]);
  });
});

describe('evaluateManifest', () => {
  it('20. combiner & totality: works identically to individual calls and handles empty states', () => {
    const emptyResult = evaluateManifest({}, { files: [], couplings: [] });
    expect(emptyResult).toStrictEqual({ protectedHits: [], violations: [] });

    const manifest: ArchitectureManifest = {
      protected: ['src/daemon'],
      separate: [{ from: 'src/ui', to: 'src/db' }],
    };
    const files: ChangedFile[] = [{ status: 'added', path: 'src/daemon/index.ts' }];
    const couplings: NewCoupling[] = [
      {
        fromModule: 'src/ui',
        toModule: 'src/db',
        fromFile: 'src/ui/app.ts',
        specifier: '../db/index.js',
      },
    ];

    const result = evaluateManifest(manifest, { files, couplings });
    expect(result.protectedHits).toStrictEqual(protectedZoneHits(manifest, files));
    expect(result.violations).toStrictEqual(boundaryViolations(manifest, couplings));
  });

  it('21. End-to-end: reproduces the worked example exactly', () => {
    const manifest: ArchitectureManifest = {
      protected: ['src/ledger.ts', 'src/daemon'],
      separate: [
        { from: 'src/bin', to: 'lib', name: 'cli-no-direct-lib' },
        { from: 'src', to: 'src/avatar', name: 'core-no-avatar' },
      ],
    };

    const files: ChangedFile[] = [
      { status: 'modified', path: 'src/ledger.ts' },
      { status: 'added', path: 'src/router.ts' },
      { status: 'renamed', path: 'src/daemon/server.ts', oldPath: 'src/server.ts' },
    ];

    const couplings: NewCoupling[] = [
      { fromModule: 'src/bin', toModule: 'lib', fromFile: 'src/bin/cli.ts', specifier: '../../lib/store.js' },
      { fromModule: 'src/bin', toModule: 'src', fromFile: 'src/bin/cli.ts', specifier: '../router.js' },
    ];

    const evaluation = evaluateManifest(manifest, { files, couplings });

    // Compare with the exact worked example results:
    expect(evaluation.protectedHits).toStrictEqual([
      {
        path: 'src/daemon/server.ts',
        status: 'renamed',
        pattern: 'src/daemon',
      },
      {
        path: 'src/ledger.ts',
        status: 'modified',
        pattern: 'src/ledger.ts',
      },
    ]);

    expect(evaluation.violations).toStrictEqual([
      {
        fromModule: 'src/bin',
        toModule: 'lib',
        fromFile: 'src/bin/cli.ts',
        specifier: '../../lib/store.js',
        rule: { from: 'src/bin', to: 'lib', name: 'cli-no-direct-lib' },
      },
    ]);
  });
});
