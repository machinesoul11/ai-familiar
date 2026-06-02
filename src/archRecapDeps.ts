import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ArchRecapDeps, SessionBase } from './archRecap.js';
import type { RepoReader } from './changeReader.js';

const RECAP_LOG_NAME = 'arch-recap.log';
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

// The real (I/O) ArchRecapDeps: git via subprocess, working-tree via fs, the recap appended to
// $FAMILIAR_HOME/arch-recap.log, and analysis deferred off the ack path via setImmediate. This is the
// untested adapter edge (verified by running), exactly like the daemon's socket bind. createArchRecapSubscriber
// (2.8) holds all the tested orchestration; this only wires real git/fs/scheduling behind ArchRecapDeps.
export function createArchRecapDeps(stateRoot: string): ArchRecapDeps {
  return {
    store: new Map<string, SessionBase>(),
    captureBase: (cwd) => gitLine(cwd, ['rev-parse', 'HEAD']),
    makeReader: (cwd) => makeGitReader(cwd),
    writeRecap: (text) => appendRecap(stateRoot, text),
    readTranscript: (path) => readFileOrNull(path),
    defer: (task) => {
      setImmediate(task);
    },
  };
}

function makeGitReader(cwd: string): RepoReader | null {
  const root = gitLine(cwd, ['rev-parse', '--show-toplevel']);
  if (root === null) {
    return null;
  }

  return {
    diffNameStatus: (baseRef) => git(root, ['diff', '--name-status', baseRef]),
    listUntracked: () => {
      const out = git(root, ['ls-files', '--others', '--exclude-standard']);
      return out === null ? [] : out.split('\n').filter((line) => line !== '');
    },
    showBlob: (baseRef, path) => git(root, ['show', `${baseRef}:${path}`]),
    readWorking: (path) => readFileOrNull(join(root, path)),
  };
}

// Raw git stdout (newline-preserving — diff/blob output must not be trimmed), or null on any failure.
function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    });
  } catch {
    return null;
  }
}

// git stdout as a single trimmed token (for rev-parse SHAs/paths), or null on failure.
function gitLine(cwd: string, args: string[]): string | null {
  const out = git(cwd, args);
  return out === null ? null : out.trim();
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function appendRecap(stateRoot: string, text: string): void {
  mkdirSync(stateRoot, { recursive: true });
  const entry = `\n===== arch recap @ ${new Date().toISOString()} =====\n${text}\n`;
  appendFileSync(join(stateRoot, RECAP_LOG_NAME), entry);
}
