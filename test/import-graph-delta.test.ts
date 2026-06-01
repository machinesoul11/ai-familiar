import { describe, it, expect } from 'vitest';
import { extractImports, resolveImport, importGraphDelta } from '../src/imports.js';
import type { ChangedFileContent, NewCoupling } from '../src/imports.js';

describe('src/imports', () => {
  describe('extractImports', () => {
    it('1. extracts static named and default imports', () => {
      const content = "import { a } from './x.js';\nimport d from \"../y.js\";";
      expect(extractImports(content)).toEqual(['./x.js', '../y.js']);
    });

    it('2. extracts side-effect, namespace, type, export-from, and dynamic imports', () => {
      const content = `
        import './a.js';
        import * as ns from './b.js';
        import type { T } from './c.js';
        export { e } from './d.js';
        export * from './e.js';
        const m = await import('./f.js');
        import {
          a,
          b
        } from './g.js';
      `;
      expect(extractImports(content)).toEqual([
        './a.js',
        './b.js',
        './c.js',
        './d.js',
        './e.js',
        './f.js',
        './g.js'
      ]);
    });

    it('3. totality: handles empty string and non-import text gracefully', () => {
      expect(extractImports('')).toEqual([]);
      expect(extractImports('just some random typescript code\nconst x = 1;')).toEqual([]);
    });
  });

  describe('resolveImport', () => {
    it('4. external specifiers resolve to null', () => {
      const fromPath = 'src/x.ts';
      expect(resolveImport(fromPath, 'react')).toBeNull();
      expect(resolveImport(fromPath, '@scope/pkg')).toBeNull();
      expect(resolveImport(fromPath, 'node:fs')).toBeNull();
      expect(resolveImport(fromPath, '/abs/path')).toBeNull();
    });

    it('5. relative specifiers resolve to POSIX-normalized intra-repo paths', () => {
      expect(resolveImport('src/bin/x.ts', '../router.js')).toBe('src/router.js');
      expect(resolveImport('src/a.ts', './b.js')).toBe('src/b.js');
      expect(resolveImport('src/a.ts', '../lib/c.js')).toBe('lib/c.js');
    });
  });

  describe('importGraphDelta', () => {
    it('6. emits new cross-module edge in an ADDED file', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/bin/added.ts',
          before: '',
          after: "import { r } from '../router.js';"
        }
      ];
      // fromModule: 'src/bin', toModule: 'src'
      expect(importGraphDelta(files)).toStrictEqual([
        {
          fromModule: 'src/bin',
          toModule: 'src',
          fromFile: 'src/bin/added.ts',
          specifier: '../router.js'
        }
      ]);
    });

    it('7. does NOT re-report a pre-existing edge', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/bin/existing.ts',
          before: "import { r } from '../router.js';",
          after: "import { r } from '../router.js';\nimport { newThing } from './local.js';"
        }
      ];
      // `../router.js` goes to `src` (existing). `./local.js` goes to `src/bin` (same-module).
      expect(importGraphDelta(files)).toStrictEqual([]);
    });

    it('8. excludes same-module imports', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/a.ts',
          before: '',
          after: "import { b } from './b.js';"
        }
      ];
      // `src/a.ts` module is `src`, `./b.js` resolves to `src/b.ts` module is `src`.
      expect(importGraphDelta(files)).toStrictEqual([]);
    });

    it('9. excludes external imports', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/a.ts',
          before: '',
          after: "import 'zod';\nimport 'node:fs';"
        }
      ];
      expect(importGraphDelta(files)).toStrictEqual([]);
    });

    it('10. uses module-level newness, not per-specifier', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/a.ts', // module: src
          before: "import { x } from '../lib/x.js';", // resolves to lib/x.ts, module: lib
          after: "import { x } from '../lib/x.js';\nimport { y } from '../lib/y.js';" // resolves to lib/y.ts, module: lib
        }
      ];
      // Both point to module `lib`. Since `lib` was in beforeTargets, nothing is new.
      expect(importGraphDelta(files)).toStrictEqual([]);
    });

    it('11. picks the lexicographically-smallest specifier as representative evidence', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/a.ts', // module: src
          before: '',
          after: "import { z } from '../lib/z.js';\nimport { a } from '../lib/a.js';"
        }
      ];
      // Both resolve to module `lib`. '../lib/a.js' < '../lib/z.js'
      expect(importGraphDelta(files)).toStrictEqual([
        {
          fromModule: 'src',
          toModule: 'lib',
          fromFile: 'src/a.ts',
          specifier: '../lib/a.js'
        }
      ]);
    });

    it('12. emits nothing for a DELETED file', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/deleted.ts',
          before: "import { x } from '../lib/x.js';",
          after: ''
        }
      ];
      expect(importGraphDelta(files)).toStrictEqual([]);
    });

    it('13. sorts output by fromFile asc then toModule asc, and dedups', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/z.ts', // module: src
          before: '',
          after: "import { a } from '../lib-b/a.js';\nimport { b } from '../lib-a/b.js';" // toModules: lib-b, lib-a
        },
        {
          path: 'src/a.ts', // module: src
          before: '',
          after: "import { x } from '../lib-c/x.js';" // toModule: lib-c
        }
      ];
      expect(importGraphDelta(files)).toStrictEqual([
        {
          fromModule: 'src',
          toModule: 'lib-c',
          fromFile: 'src/a.ts',
          specifier: '../lib-c/x.js'
        },
        {
          fromModule: 'src',
          toModule: 'lib-a',
          fromFile: 'src/z.ts',
          specifier: '../lib-a/b.js'
        },
        {
          fromModule: 'src',
          toModule: 'lib-b',
          fromFile: 'src/z.ts',
          specifier: '../lib-b/a.js'
        }
      ]);
    });

    it('14. totality: handles empty input and files with only excluded edges without throwing', () => {
      expect(importGraphDelta([])).toStrictEqual([]);
      
      const files: ChangedFileContent[] = [
        {
          path: 'src/no-imports.ts',
          before: '',
          after: 'const x = 1;'
        },
        {
          path: 'src/only-excluded.ts',
          before: "import { a } from './a.js';",
          after: "import { a } from './a.js';\nimport 'react';"
        }
      ];
      expect(importGraphDelta(files)).toStrictEqual([]);
    });

    it('15. matches the end-to-end worked example exactly', () => {
      const files: ChangedFileContent[] = [
        {
          path: 'src/bin/cli.ts',
          before: "import { route } from '../router.js';",
          after: "import { route } from '../router.js';\nimport { db } from '../../lib/store.js';"
        },
        {
          path: 'src/router.ts',
          before: "",
          after: "import { z } from 'zod';\nimport { x } from './normalize.js';"
        }
      ];
      expect(importGraphDelta(files)).toStrictEqual([
        {
          fromModule: 'src/bin',
          toModule: 'lib',
          fromFile: 'src/bin/cli.ts',
          specifier: '../../lib/store.js'
        }
      ]);
    });
  });
});
