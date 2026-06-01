import type { ChangeStatus, ChangedFile } from './diff.js';
import type { NewCoupling } from './imports.js';

export interface SeparationRule {
  from: string;
  to: string;
  name?: string;
}

export interface ArchitectureManifest {
  protected?: string[];
  separate?: SeparationRule[];
}

export interface ProtectedHit {
  path: string;
  status: ChangeStatus;
  pattern: string;
}

export interface BoundaryViolation {
  fromModule: string;
  toModule: string;
  fromFile: string;
  specifier: string;
  rule: SeparationRule;
}

export interface ArchEvaluation {
  protectedHits: ProtectedHit[];
  violations: BoundaryViolation[];
}

export function matchesPattern(path: string, pattern: string): boolean {
  const pat = stripTrailingSlash(pattern);

  return pat !== '' && (path === pat || path.startsWith(`${pat}/`));
}

export function protectedZoneHits(
  manifest: ArchitectureManifest,
  files: ChangedFile[],
): ProtectedHit[] {
  const patterns = (manifest.protected ?? []).filter(isNonEmptyPattern);
  const hits: ProtectedHit[] = [];

  for (const file of files) {
    const pattern = smallestMatchingPattern(file, patterns);
    if (pattern !== null) {
      hits.push({ path: file.path, status: file.status, pattern });
    }
  }

  return hits.sort(compareProtectedHit);
}

export function boundaryViolations(
  manifest: ArchitectureManifest,
  couplings: NewCoupling[],
): BoundaryViolation[] {
  const rules = (manifest.separate ?? []).filter(isNonEmptyRule);
  const violations: BoundaryViolation[] = [];

  for (const coupling of couplings) {
    for (const rule of rules) {
      if (
        matchesPattern(coupling.fromModule, rule.from)
        && matchesPattern(coupling.toModule, rule.to)
      ) {
        violations.push({
          fromModule: coupling.fromModule,
          toModule: coupling.toModule,
          fromFile: coupling.fromFile,
          specifier: coupling.specifier,
          rule,
        });
      }
    }
  }

  return violations.sort(compareBoundaryViolation);
}

export function evaluateManifest(
  manifest: ArchitectureManifest,
  input: { files: ChangedFile[]; couplings: NewCoupling[] },
): ArchEvaluation {
  return {
    protectedHits: protectedZoneHits(manifest, input.files),
    violations: boundaryViolations(manifest, input.couplings),
  };
}

function stripTrailingSlash(pattern: string): string {
  return pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
}

function isNonEmptyPattern(pattern: string): boolean {
  return stripTrailingSlash(pattern) !== '';
}

function isNonEmptyRule(rule: SeparationRule): boolean {
  return isNonEmptyPattern(rule.from) && isNonEmptyPattern(rule.to);
}

function smallestMatchingPattern(file: ChangedFile, patterns: string[]): string | null {
  let smallest: string | null = null;

  for (const pattern of patterns) {
    if (
      matchesPattern(file.path, pattern)
      || (
        file.status === 'renamed'
        && file.oldPath !== undefined
        && matchesPattern(file.oldPath, pattern)
      )
    ) {
      if (smallest === null || pattern < smallest) {
        smallest = pattern;
      }
    }
  }

  return smallest;
}

function compareProtectedHit(a: ProtectedHit, b: ProtectedHit): number {
  return compareStrings(a.path, b.path) || compareStrings(a.pattern, b.pattern);
}

function compareBoundaryViolation(a: BoundaryViolation, b: BoundaryViolation): number {
  return compareStrings(a.fromFile, b.fromFile)
    || compareStrings(a.toModule, b.toModule)
    || compareStrings(a.rule.from, b.rule.from)
    || compareStrings(a.rule.to, b.rule.to);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
