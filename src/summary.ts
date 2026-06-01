import { modulesTouched, type ChangedFile, type ModuleDelta } from './diff.js';
import { importGraphDelta, type ChangedFileContent, type NewCoupling } from './imports.js';
import {
  evaluateManifest,
  type ArchitectureManifest,
  type BoundaryViolation,
  type ProtectedHit,
} from './manifest.js';

export interface ArchSummary {
  kind: 'arch-summary';
  modules: ModuleDelta[];
  newCouplings: NewCoupling[];
  protectedHits: ProtectedHit[];
  violations: BoundaryViolation[];
}

export function buildArchSummary(input: {
  files: ChangedFile[];
  contents: ChangedFileContent[];
  manifest?: ArchitectureManifest;
}): ArchSummary {
  const modules = modulesTouched(input.files);
  const newCouplings = importGraphDelta(input.contents);
  const { protectedHits, violations } = evaluateManifest(input.manifest ?? {}, {
    files: input.files,
    couplings: newCouplings,
  });

  return {
    kind: 'arch-summary',
    modules,
    newCouplings,
    protectedHits,
    violations,
  };
}
