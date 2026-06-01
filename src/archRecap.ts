import { readChange, type RepoReader } from './changeReader.js';
import { parseManifest, MANIFEST_PATH } from './manifestLoader.js';
import { formatArchRecap } from './recap.js';
import { buildArchSummary } from './summary.js';
import type { EventSubscriber } from './bus.js';
import type { NormalizedEvent } from './normalize.js';

export interface SessionBase {
  baseRef: string;
  cwd: string;
}

export interface ArchRecapDeps {
  captureBase(cwd: string): string | null;
  makeReader(cwd: string): RepoReader | null;
  writeRecap(text: string): void;
  defer(task: () => void): void;
  store?: Map<string, SessionBase>;
}

export function createArchRecapSubscriber(deps: ArchRecapDeps): EventSubscriber {
  const store = deps.store ?? new Map<string, SessionBase>();

  return (event: NormalizedEvent) => {
    try {
      if (!isRecord(event) || typeof event.sessionId !== 'string') {
        return;
      }

      if (event.kind === 'session-start') {
        const cwd = cwdOf(event);

        if (cwd === null) {
          return;
        }

        deferSafely(deps, () => {
          const baseRef = deps.captureBase(cwd);

          if (baseRef !== null) {
            store.set(event.sessionId, { baseRef, cwd });
          }
        });
        return;
      }

      if (event.kind === 'run-finished') {
        const base = store.get(event.sessionId);

        if (base === undefined) {
          return;
        }

        deferSafely(deps, () => {
          const reader = deps.makeReader(base.cwd);

          if (reader === null) {
            return;
          }

          const { files, contents } = readChange(reader, base.baseRef);
          const manifest = parseManifest(reader.readWorking(MANIFEST_PATH));
          const summary = buildArchSummary({ files, contents, manifest });
          deps.writeRecap(formatArchRecap(summary));
        });
        return;
      }

      if (event.kind === 'session-end') {
        store.delete(event.sessionId);
      }
    } catch {
      return;
    }
  };
}

function deferSafely(deps: ArchRecapDeps, task: () => void): void {
  try {
    deps.defer(() => {
      try {
        task();
      } catch {
        return;
      }
    });
  } catch {
    return;
  }
}

function cwdOf(event: NormalizedEvent): string | null {
  const payload = event.raw?.payload;

  if (!isRecord(payload) || typeof payload.cwd !== 'string' || payload.cwd === '') {
    return null;
  }

  return payload.cwd;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
