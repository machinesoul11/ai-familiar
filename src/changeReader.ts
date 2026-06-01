import { parseNameStatus, type ChangedFile } from './diff.js';
import type { ChangedFileContent } from './imports.js';

export interface RepoReader {
  diffNameStatus(baseRef: string): string | null;
  listUntracked(): string[];
  showBlob(baseRef: string, path: string): string | null;
  readWorking(path: string): string | null;
}

export function readChange(
  reader: RepoReader,
  baseRef: string,
): { files: ChangedFile[]; contents: ChangedFileContent[] } {
  const raw = reader.diffNameStatus(baseRef);
  const tracked = raw === null ? [] : parseNameStatus(raw);
  const untracked = reader.listUntracked().map((path): ChangedFile => ({
    status: 'added',
    path,
  }));
  const files = [...tracked, ...untracked];
  const contents = files.map((file): ChangedFileContent => {
    const beforePath = beforeContentPath(file);

    return {
      path: file.path,
      before: reader.showBlob(baseRef, beforePath) ?? '',
      after: reader.readWorking(file.path) ?? '',
    };
  });

  return { files, contents };
}

function beforeContentPath(file: ChangedFile): string {
  return file.status === 'renamed' && file.oldPath !== undefined
    ? file.oldPath
    : file.path;
}
