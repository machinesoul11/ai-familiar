import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_FILENAME } from './settings.js';
import { readSettingsText } from './effectiveConfig.js';

export { readSettingsText };

export function readEnvText(stateRoot: string): string | null {
  try {
    return readFileSync(join(stateRoot, '.env'), 'utf8');
  } catch {
    return null;
  }
}

export function writeSettingsFile(stateRoot: string, text: string): void {
  writeAtomicFile(join(stateRoot, SETTINGS_FILENAME), stateRoot, text, 0o644);
}

export function writeEnvFile(stateRoot: string, text: string): void {
  writeAtomicFile(join(stateRoot, '.env'), stateRoot, text, 0o600);
}

function writeAtomicFile(path: string, stateRoot: string, text: string, mode: number): void {
  mkdirSync(stateRoot, { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, text, { mode });
  renameSync(tmpPath, path);
}
