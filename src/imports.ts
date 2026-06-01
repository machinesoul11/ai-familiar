import { posix } from 'node:path';

import { moduleOf } from './diff.js';

export interface ChangedFileContent {
  path: string;
  before: string;
  after: string;
}

export interface NewCoupling {
  fromModule: string;
  toModule: string;
  fromFile: string;
  specifier: string;
}

interface ImportMatch {
  index: number;
  specifier: string;
}

export function extractImports(content: string): string[] {
  const matches: ImportMatch[] = [];
  const patterns = [
    /\bimport\s+(?!['"(])(?:type\s+)?[^;]*?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^;]*?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        matches.push({ index: match.index, specifier });
      }
    }
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .map((match) => match.specifier);
}

export function resolveImport(fromPath: string, specifier: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null;
  }

  return posix.normalize(posix.join(posix.dirname(fromPath), specifier));
}

export function importGraphDelta(files: ChangedFileContent[]): NewCoupling[] {
  const couplings: NewCoupling[] = [];
  const emitted = new Set<string>();

  for (const file of files) {
    const fromModule = moduleOf(file.path);
    const beforeTargets = crossBoundaryTargets(file.path, fromModule, file.before);
    const afterTargets = crossBoundaryTargets(file.path, fromModule, file.after);

    for (const toModule of afterTargets) {
      if (beforeTargets.has(toModule)) {
        continue;
      }

      const specifier = smallestSpecifierForModule(file.path, toModule, file.after);
      const key = `${file.path}\u0000${toModule}`;
      if (specifier !== null && !emitted.has(key)) {
        emitted.add(key);
        couplings.push({
          fromModule,
          toModule,
          fromFile: file.path,
          specifier,
        });
      }
    }
  }

  return couplings.sort(compareCoupling);
}

function crossBoundaryTargets(
  fromPath: string,
  fromModule: string,
  content: string,
): Set<string> {
  const targets = new Set<string>();

  for (const specifier of extractImports(content)) {
    const resolved = resolveImport(fromPath, specifier);
    if (resolved === null) {
      continue;
    }

    const toModule = moduleOf(resolved);
    if (toModule !== fromModule) {
      targets.add(toModule);
    }
  }

  return targets;
}

function smallestSpecifierForModule(
  fromPath: string,
  toModule: string,
  content: string,
): string | null {
  let smallest: string | null = null;

  for (const specifier of extractImports(content)) {
    const resolved = resolveImport(fromPath, specifier);
    if (resolved !== null && moduleOf(resolved) === toModule) {
      if (smallest === null || specifier < smallest) {
        smallest = specifier;
      }
    }
  }

  return smallest;
}

function compareCoupling(a: NewCoupling, b: NewCoupling): number {
  return compareStrings(a.fromFile, b.fromFile) || compareStrings(a.toModule, b.toModule);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
