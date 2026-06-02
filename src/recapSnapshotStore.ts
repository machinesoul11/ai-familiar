import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeSnapshot, type RecapSnapshot } from './recapSnapshot.js';

export const SNAPSHOT_NAME = 'latest-recap.json';

export function writeSnapshotFile(stateRoot: string, snapshot: RecapSnapshot): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(join(stateRoot, SNAPSHOT_NAME), serializeSnapshot(snapshot));
}

export function readSnapshotFile(stateRoot: string): string | null {
  try {
    return readFileSync(join(stateRoot, SNAPSHOT_NAME), 'utf8');
  } catch {
    return null;
  }
}
