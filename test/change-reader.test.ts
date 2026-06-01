import { describe, it, expect } from 'vitest';
import { readChange, type RepoReader } from '../src/changeReader.js';

/**
 * CONTRACT CONCERNS:
 * 1. The contract specifies 'C' tokens in diffNameStatus fold as 'added' at the destination.
 *    It says "C/C<score> -> added at destination (3rd field; copy source dropped)".
 *    I will test that the 3rd field is used as the 'path' and the 2nd field is ignored.
 * 2. The contract says for renamed files: "beforePath = f.oldPath if f.status === 'renamed'
 *    (and oldPath is defined), else f.path." I will verify this with a test case where
 *    old and new paths both exist but only the old one should be read for 'before'.
 */

describe('readChange', () => {
  // Helper to build fakes as suggested by Contract 2.5
  interface FakeData {
    diffNameStatus: string | null;
    listUntracked: string[];
    showBlob: Map<string, string | null>;
    readWorking: Map<string, string | null>;
  }

  function createFakeReader(data: FakeData): RepoReader {
    return {
      diffNameStatus: (baseRef: string) => data.diffNameStatus,
      listUntracked: () => data.listUntracked,
      showBlob: (baseRef: string, path: string) => data.showBlob.get(`${baseRef} ${path}`) ?? null,
      readWorking: (path: string) => data.readWorking.get(path) ?? null,
    };
  }

  describe('Basic Tracked File States (Criteria 1-3)', () => {
    it('handles modified, added, and deleted tracked files', () => {
      const data: FakeData = {
        diffNameStatus: "M\tmod.ts\nA\tadd.ts\nD\tdel.ts",
        listUntracked: [],
        showBlob: new Map([
          ['BASE mod.ts', 'mod-v1'],
          ['BASE del.ts', 'del-v1'],
        ]),
        readWorking: new Map([
          ['mod.ts', 'mod-v2'],
          ['add.ts', 'add-v1'],
        ]),
      };
      const result = readChange(createFakeReader(data), 'BASE');

      expect(result.files).toStrictEqual([
        { status: 'modified', path: 'mod.ts' },
        { status: 'added', path: 'add.ts' },
        { status: 'deleted', path: 'del.ts' },
      ]);

      expect(result.contents).toStrictEqual([
        { path: 'mod.ts', before: 'mod-v1', after: 'mod-v2' },
        { path: 'add.ts', before: '', after: 'add-v1' },
        { path: 'del.ts', before: 'del-v1', after: '' },
      ]);
    });
  });

  describe('Renames and Path Selection (Criterion 4)', () => {
    it('uses the old path for "before" content and the new path for "after" content on renames', () => {
      const data: FakeData = {
        diffNameStatus: "R100\told_name.ts\tnew_name.ts",
        listUntracked: [],
        showBlob: new Map([
          ['BASE old_name.ts', 'content from old path'],
          ['BASE new_name.ts', 'WRONG BLOB'],
        ]),
        readWorking: new Map([
          ['old_name.ts', 'WRONG WORKING'],
          ['new_name.ts', 'content from new path'],
        ]),
      };
      const result = readChange(createFakeReader(data), 'BASE');

      expect(result.files).toStrictEqual([
        { status: 'renamed', path: 'new_name.ts', oldPath: 'old_name.ts' },
      ]);

      expect(result.contents).toStrictEqual([
        { path: 'new_name.ts', before: 'content from old path', after: 'content from new path' },
      ]);
    });
  });

  describe('Untracked Files (Criterion 5)', () => {
    it('treats untracked files as "added" with no "before" content', () => {
      const data: FakeData = {
        diffNameStatus: "",
        listUntracked: ['untracked.ts'],
        showBlob: new Map(),
        readWorking: new Map([
          ['untracked.ts', 'freshly created'],
        ]),
      };
      const result = readChange(createFakeReader(data), 'BASE');

      expect(result.files).toStrictEqual([
        { status: 'added', path: 'untracked.ts' },
      ]);

      expect(result.contents).toStrictEqual([
        { path: 'untracked.ts', before: '', after: 'freshly created' },
      ]);
    });
  });

  describe('Ordering and Parallelism (Criterion 6)', () => {
    it('emits tracked files (in parse order) then untracked files (in list order)', () => {
      const data: FakeData = {
        diffNameStatus: "M\ttracked_2.ts\nM\ttracked_1.ts",
        listUntracked: ['untracked_2.ts', 'untracked_1.ts'],
        showBlob: new Map(),
        readWorking: new Map(),
      };
      const result = readChange(createFakeReader(data), 'BASE');

      const expectedOrder = ['tracked_2.ts', 'tracked_1.ts', 'untracked_2.ts', 'untracked_1.ts'];
      expect(result.files.map(f => f.path)).toStrictEqual(expectedOrder);
      expect(result.contents.map(c => c.path)).toStrictEqual(expectedOrder);
      expect(result.contents.length).toBe(result.files.length);
    });
  });

  describe('Grammar and parseNameStatus Reuse (Criterion 7)', () => {
    it('handles T tokens as modified and C tokens as added at destination', () => {
      const data: FakeData = {
        diffNameStatus: "T\ttype_change.ts\nC100\tsource.ts\tcopy_dest.ts",
        listUntracked: [],
        showBlob: new Map([['BASE type_change.ts', 'before-t']]),
        readWorking: new Map([
          ['type_change.ts', 'after-t'],
          ['copy_dest.ts', 'after-c'],
        ]),
      };
      const result = readChange(createFakeReader(data), 'BASE');

      expect(result.files).toStrictEqual([
        { status: 'modified', path: 'type_change.ts' },
        { status: 'added', path: 'copy_dest.ts' },
      ]);

      expect(result.contents).toStrictEqual([
        { path: 'type_change.ts', before: 'before-t', after: 'after-t' },
        { path: 'copy_dest.ts', before: '', after: 'after-c' },
      ]);
    });

    it('skips blank and malformed lines in diffNameStatus', () => {
      const data: FakeData = {
        diffNameStatus: "\n  \nINVALID_LINE\nM\tvalid.ts\n",
        listUntracked: [],
        showBlob: new Map([['BASE valid.ts', 'v1']]),
        readWorking: new Map([['valid.ts', 'v2']]),
      };
      const result = readChange(createFakeReader(data), 'BASE');

      expect(result.files).toStrictEqual([
        { status: 'modified', path: 'valid.ts' },
      ]);
    });
  });

  describe('Totality and Failures (Criteria 8-9)', () => {
    it('returns empty results when reader returns null for diffNameStatus', () => {
      const data: FakeData = {
        diffNameStatus: null,
        listUntracked: [],
        showBlob: new Map(),
        readWorking: new Map(),
      };
      const result = readChange(createFakeReader(data), 'BASE');
      expect(result).toStrictEqual({ files: [], contents: [] });
    });

    it('uses empty strings when showBlob or readWorking return null', () => {
      const data: FakeData = {
        diffNameStatus: "M\tmissing_all.ts",
        listUntracked: [],
        showBlob: new Map([['BASE missing_all.ts', null]]), // missing in base
        readWorking: new Map([['missing_all.ts', null]]), // missing in working
      };
      const result = readChange(createFakeReader(data), 'BASE');

      expect(result.contents[0]).toStrictEqual({
        path: 'missing_all.ts',
        before: '',
        after: '',
      });
    });
  });

  describe('Determinism (Criterion 10)', () => {
    it('is deterministic over the same reader responses', () => {
      const data: FakeData = {
        diffNameStatus: "M\ta.ts",
        listUntracked: ['b.ts'],
        showBlob: new Map([['BASE a.ts', 'blob']]),
        readWorking: new Map([['a.ts', 'work-a'], ['b.ts', 'work-b']]),
      };
      const reader = createFakeReader(data);
      const res1 = readChange(reader, 'BASE');
      const res2 = readChange(reader, 'BASE');
      expect(res1).toStrictEqual(res2);
    });
  });

  describe('End-to-End Worked Example (Criterion 11)', () => {
    it('reproduces the contract worked example exactly', () => {
      const data: FakeData = {
        diffNameStatus:
          "M\tsrc/router.ts\n" +
          "D\tsrc/old.ts\n" +
          "R100\tsrc/a/widget.ts\tsrc/b/widget.ts",
        listUntracked: ['src/b/new.ts'],
        showBlob: new Map([
          ['BASE src/router.ts', "import { x } from './x.js';"],
          ['BASE src/old.ts', "export const gone = 1;"],
          ['BASE src/a/widget.ts', "import { dep } from '../a/dep.js';"],
          ['BASE src/b/new.ts', null],
        ]),
        readWorking: new Map([
          ['src/router.ts', "import { x } from './x.js';\nimport { y } from './y.js';"],
          ['src/old.ts', null],
          ['src/b/widget.ts', "import { dep } from '../a/dep.js';"],
          ['src/b/new.ts', "export const fresh = 2;"],
        ]),
      };

      const result = readChange(createFakeReader(data), 'BASE');

      expect(result).toStrictEqual({
        files: [
          { status: 'modified', path: 'src/router.ts' },
          { status: 'deleted',  path: 'src/old.ts' },
          { status: 'renamed',  path: 'src/b/widget.ts', oldPath: 'src/a/widget.ts' },
          { status: 'added',    path: 'src/b/new.ts' },
        ],
        contents: [
          { path: 'src/router.ts',   before: "import { x } from './x.js';",            after: "import { x } from './x.js';\nimport { y } from './y.js';" },
          { path: 'src/old.ts',      before: "export const gone = 1;",                 after: '' },
          { path: 'src/b/widget.ts', before: "import { dep } from '../a/dep.js';",     after: "import { dep } from '../a/dep.js';" },
          { path: 'src/b/new.ts',    before: '',                                        after: "export const fresh = 2;" },
        ],
      });
    });
  });
});
