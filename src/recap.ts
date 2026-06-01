import type { ArchSummary } from './summary.js';

export function formatArchRecap(summary: ArchSummary): string {
  const sections = [
    formatModules(summary),
    formatNewCouplings(summary),
    formatProtectedHits(summary),
    formatViolations(summary),
  ].filter((section): section is string => section !== null);

  return sections.length === 0
    ? 'No architectural changes detected.'
    : sections.join('\n\n');
}

function formatModules(summary: ArchSummary): string | null {
  if (summary.modules.length === 0) {
    return null;
  }

  return [
    `Modules changed (${summary.modules.length}):`,
    ...summary.modules.map((delta) => (
      `  ${delta.module}: +${delta.added} ~${delta.modified} -${delta.deleted} R${delta.renamed}`
    )),
  ].join('\n');
}

function formatNewCouplings(summary: ArchSummary): string | null {
  if (summary.newCouplings.length === 0) {
    return null;
  }

  return [
    `New cross-module coupling (${summary.newCouplings.length}):`,
    ...summary.newCouplings.map((coupling) => (
      `  ${coupling.fromFile}: ${coupling.fromModule} -> ${coupling.toModule} (${coupling.specifier})`
    )),
  ].join('\n');
}

function formatProtectedHits(summary: ArchSummary): string | null {
  if (summary.protectedHits.length === 0) {
    return null;
  }

  return [
    `Protected zones touched (${summary.protectedHits.length}):`,
    ...summary.protectedHits.map((hit) => (
      `  ${hit.path} [${hit.status}] (matched ${hit.pattern})`
    )),
  ].join('\n');
}

function formatViolations(summary: ArchSummary): string | null {
  if (summary.violations.length === 0) {
    return null;
  }

  return [
    `Boundary violations (${summary.violations.length}):`,
    ...summary.violations.map((violation) => (
      `  ${violation.fromFile}: ${violation.fromModule} -> ${violation.toModule} violates ${ruleLabel(violation.rule)}`
    )),
  ].join('\n');
}

function ruleLabel(rule: ArchSummary['violations'][number]['rule']): string {
  return typeof rule.name === 'string' && rule.name !== ''
    ? rule.name
    : `${rule.from} -> ${rule.to}`;
}
