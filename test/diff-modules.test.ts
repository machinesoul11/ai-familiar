import { describe, it, expect } from 'vitest';
import { parseNameStatus, moduleOf, modulesTouched } from '../src/diff.js';
import type { ChangedFile, ModuleDelta, ChangeStatus } from '../src/diff.js';

describe('src/diff.ts', () => {
  describe('Criterion 1: Basic statuses (A, M, D)', () => {
    it('should parse added, modified, and deleted files correctly', () => {
      const raw = "A\tsrc/a.ts\nM\tsrc/b.ts\nD\tsrc/c.ts";
      const expected: ChangedFile[] = [
        { status: 'added', path: 'src/a.ts' },
        { status: 'modified', path: 'src/b.ts' },
        { status: 'deleted', path: 'src/c.ts' },
      ];
      expect(parseNameStatus(raw)).toEqual(expected);
    });
  });

  describe('Criterion 2: Type change folds to modified', () => {
    it('should treat type changes (T) as modified', () => {
      const raw = "T\tsrc/x.ts";
      const expected: ChangedFile[] = [
        { status: 'modified', path: 'src/x.ts' },
      ];
      expect(parseNameStatus(raw)).toEqual(expected);
    });
  });

  describe('Criterion 3: Rename (R/R<score>)', () => {
    it('should parse renames with and without scores', () => {
      const raw = "R100\tsrc/old.ts\tsrc/new.ts\nR\tlegacy.ts\tmodern.ts";
      const expected: ChangedFile[] = [
        { status: 'renamed', path: 'src/new.ts', oldPath: 'src/old.ts' },
        { status: 'renamed', path: 'modern.ts', oldPath: 'legacy.ts' },
      ];
      expect(parseNameStatus(raw)).toEqual(expected);
    });
  });

  describe('Criterion 4: Copy folds to added at destination', () => {
    it('should parse copies as added files at the destination path, dropping the source', () => {
      const raw = "C75\tsrc/tpl.ts\tsrc/copy.ts";
      const expected: ChangedFile[] = [
        { status: 'added', path: 'src/copy.ts' },
      ];
      const result = parseNameStatus(raw);
      expect(result).toEqual(expected);
      expect(result[0]).not.toHaveProperty('oldPath');
    });
  });

  describe('Criterion 5: Totality / robustness', () => {
    it('should handle empty string, whitespace-only lines, CRLF, and malformed lines', () => {
      const raw = "\n  \n\nA\tsrc/valid.ts\r\nX\tunknown.ts\nR\tmissing-dest.ts\nM\ttoo\tmany\tfields.ts";
      // M\ttoo\tmany\tfields.ts: The rule says "split on \t into a status token and path field(s)".
      // For M, it requires 1 path. If it has more, it might be ignored or take the first one.
      // Contract says: "a line whose status token is unrecognized, or which is missing a required path field... is skipped"
      // "M" requires 1 path field. "M\ttoo\tmany\tfields.ts" has 3 path fields. 
      // Usually git name-status is exactly status\tpath or status\tpath1\tpath2.
      // Let's stick to what's explicit: unrecognized token (X) and missing required field (R with 1 path).
      
      const expected: ChangedFile[] = [
        { status: 'added', path: 'src/valid.ts' },
      ];
      expect(parseNameStatus(raw)).toEqual(expected);
      expect(parseNameStatus('')).toEqual([]);
    });
  });

  describe('Criterion 6: moduleOf', () => {
    it('should derive the POSIX dirname correctly', () => {
      expect(moduleOf('src/router.ts')).toBe('src');
      expect(moduleOf('src/bin/x.ts')).toBe('src/bin');
      expect(moduleOf('a/b/c/d.ts')).toBe('a/b/c');
      expect(moduleOf('package.json')).toBe('.');
      expect(moduleOf('root.ts')).toBe('.');
    });
  });

  describe('Criterion 7: Grouping + counts', () => {
    it('should group changed files into modules and tally counts correctly', () => {
      const files: ChangedFile[] = [
        { status: 'added', path: 'src/a.ts' },
        { status: 'modified', path: 'src/b.ts' },
        { status: 'deleted', path: 'tests/a.test.ts' },
      ];
      const result = modulesTouched(files);
      expect(result).toHaveLength(2);
      
      const src = result.find(m => m.module === 'src');
      expect(src).toBeDefined();
      expect(src?.added).toBe(1);
      expect(src?.modified).toBe(1);
      expect(src?.files).toHaveLength(2);

      const tests = result.find(m => m.module === 'tests');
      expect(tests).toBeDefined();
      expect(tests?.deleted).toBe(1);
      expect(tests?.files).toHaveLength(1);
    });
  });

  describe('Criterion 8: Cross-module rename touches BOTH source and destination', () => {
    it('should attribute a cross-module rename to both modules and increment counts', () => {
      const files: ChangedFile[] = [
        { status: 'renamed', path: 'lib/legacy.ts', oldPath: 'src/legacy.ts' }
      ];
      const result = modulesTouched(files);
      
      expect(result).toHaveLength(2);
      const src = result.find(m => m.module === 'src');
      const lib = result.find(m => m.module === 'lib');
      
      expect(src?.renamed).toBe(1);
      expect(src?.files[0]).toEqual(files[0]);
      
      expect(lib?.renamed).toBe(1);
      expect(lib?.files[0]).toEqual(files[0]);
    });
  });

  describe('Criterion 9: Within-module rename counted once', () => {
    it('should attribute a within-module rename to only one module', () => {
      const files: ChangedFile[] = [
        { status: 'renamed', path: 'src/new.ts', oldPath: 'src/old.ts' }
      ];
      const result = modulesTouched(files);
      
      expect(result).toHaveLength(1);
      expect(result[0].module).toBe('src');
      expect(result[0].renamed).toBe(1);
      expect(result[0].files).toHaveLength(1);
    });
  });

  describe('Criterion 10: Root-level file -> "."', () => {
    it('should group root-level files under the "." module', () => {
      const files: ChangedFile[] = [
        { status: 'modified', path: 'package.json' }
      ];
      const result = modulesTouched(files);
      expect(result).toHaveLength(1);
      expect(result[0].module).toBe('.');
    });
  });

  describe('Criterion 11: oldPath shape discipline', () => {
    it('should have oldPath present ONLY for renamed files', () => {
      expect(parseNameStatus("A\tx.ts")[0]).toStrictEqual({ status: 'added',    path: 'x.ts' });
      expect(parseNameStatus("M\tx.ts")[0]).toStrictEqual({ status: 'modified', path: 'x.ts' });
      expect(parseNameStatus("D\tx.ts")[0]).toStrictEqual({ status: 'deleted',  path: 'x.ts' });
      expect(parseNameStatus("C75\ts.ts\td.ts")[0]).toStrictEqual({ status: 'added', path: 'd.ts' });
      expect(parseNameStatus("R100\told.ts\tnew.ts")[0]).toStrictEqual({ status: 'renamed', path: 'new.ts', oldPath: 'old.ts' });
    });
  });

  describe('Criterion 12: Deterministic sorting', () => {
    it('should produce identical output regardless of input order', () => {
      const files: ChangedFile[] = [
        { status: 'modified', path: 'src/router.ts' },
        { status: 'added', path: 'src/bin/familiar-cli.ts' },
        { status: 'deleted', path: 'test/old.test.ts' },
        { status: 'renamed', path: 'lib/legacy.ts', oldPath: 'src/legacy.ts' },
      ];

      const result1 = modulesTouched(files);

      // Deterministic shuffle: reverse the array
      const shuffledFiles = [...files].reverse();
      const result2 = modulesTouched(shuffledFiles);

      expect(result1).toEqual(result2);

      // Verify specific sorting requirements: modules asc, files by path asc
      // Order should be: lib, src, src/bin, test
      const modules = result1.map(m => m.module);
      expect(modules).toEqual(['lib', 'src', 'src/bin', 'test']);

      const srcDelta = result1.find(m => m.module === 'src')!;
      const srcPaths = srcDelta.files.map(f => f.path);
      // lib/legacy.ts (renamed from src/legacy.ts) and src/router.ts
      expect(srcPaths).toEqual(['lib/legacy.ts', 'src/router.ts']);
    });
  });

  describe('Criterion 13: Empty input', () => {
    it('should return an empty array for empty input', () => {
      expect(modulesTouched([])).toEqual([]);
    });
  });

  describe('Criterion 14: End-to-end (Worked Example)', () => {
    it('should reproduce the worked example from the contract', () => {
      const raw = `M\tsrc/router.ts
A\tsrc/bin/familiar-cli.ts
D\ttest/old.test.ts
R100\tsrc/legacy.ts\tlib/legacy.ts
R100\tsrc/a.ts\tsrc/b.ts
C75\tsrc/tpl.ts\tsrc/copy.ts
A\tpackage.json`;

      const result = modulesTouched(parseNameStatus(raw));

      // Expected modules: '.', 'lib', 'src', 'src/bin', 'test'
      expect(result.map(m => m.module)).toEqual(['.', 'lib', 'src', 'src/bin', 'test']);

      // .
      expect(result[0]).toMatchObject({
        module: '.',
        added: 1,
        files: [{ status: 'added', path: 'package.json' }]
      });

      // lib
      expect(result[1]).toMatchObject({
        module: 'lib',
        renamed: 1,
        files: [{ status: 'renamed', path: 'lib/legacy.ts', oldPath: 'src/legacy.ts' }]
      });

      // src
      expect(result[2].module).toBe('src');
      expect(result[2].added).toBe(1);
      expect(result[2].modified).toBe(1);
      expect(result[2].renamed).toBe(2);
      expect(result[2].files.map(f => f.path)).toEqual([
        'lib/legacy.ts',
        'src/b.ts',
        'src/copy.ts',
        'src/router.ts'
      ]);

      // src/bin
      expect(result[3]).toMatchObject({
        module: 'src/bin',
        added: 1,
        files: [{ status: 'added', path: 'src/bin/familiar-cli.ts' }]
      });

      // test
      expect(result[4]).toMatchObject({
        module: 'test',
        deleted: 1,
        files: [{ status: 'deleted', path: 'test/old.test.ts' }]
      });
    });
  });
});
