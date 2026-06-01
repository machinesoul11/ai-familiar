export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
}

export interface ModuleDelta {
  module: string;
  files: ChangedFile[];
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
}

export function parseNameStatus(raw: string): ChangedFile[] {
  const files: ChangedFile[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') {
      continue;
    }

    const fields = line.split('\t');
    const [token] = fields;

    if (token === 'A' && fields.length === 2) {
      files.push({ status: 'added', path: fields[1] });
    } else if (token === 'M' && fields.length === 2) {
      files.push({ status: 'modified', path: fields[1] });
    } else if (token === 'D' && fields.length === 2) {
      files.push({ status: 'deleted', path: fields[1] });
    } else if (token === 'T' && fields.length === 2) {
      files.push({ status: 'modified', path: fields[1] });
    } else if (isScoredToken(token, 'R') && fields.length === 3) {
      files.push({ status: 'renamed', path: fields[2], oldPath: fields[1] });
    } else if (isScoredToken(token, 'C') && fields.length === 3) {
      files.push({ status: 'added', path: fields[2] });
    }
  }

  return files;
}

export function moduleOf(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? '.' : path.slice(0, lastSlash);
}

export function modulesTouched(files: ChangedFile[]): ModuleDelta[] {
  const byModule = new Map<string, ModuleDelta>();

  for (const file of files) {
    for (const moduleName of attributedModules(file)) {
      const delta = ensureModule(byModule, moduleName);
      delta.files.push(file);
      delta[file.status] += 1;
    }
  }

  return [...byModule.values()]
    .map((delta) => ({
      ...delta,
      files: [...delta.files].sort(compareChangedFilePath),
    }))
    .sort(compareModuleDelta);
}

function isScoredToken(token: string | undefined, kind: 'R' | 'C'): boolean {
  return token !== undefined && new RegExp(`^${kind}\\d*$`).test(token);
}

function attributedModules(file: ChangedFile): string[] {
  const destinationModule = moduleOf(file.path);

  if (file.status !== 'renamed') {
    return [destinationModule];
  }

  const sourceModule = moduleOf(file.oldPath ?? '');
  return sourceModule === destinationModule
    ? [destinationModule]
    : [destinationModule, sourceModule];
}

function ensureModule(
  modules: Map<string, ModuleDelta>,
  moduleName: string,
): ModuleDelta {
  let delta = modules.get(moduleName);
  if (delta === undefined) {
    delta = {
      module: moduleName,
      files: [],
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
    };
    modules.set(moduleName, delta);
  }

  return delta;
}

function compareChangedFilePath(a: ChangedFile, b: ChangedFile): number {
  return compareStrings(a.path, b.path)
    || compareStrings(a.status, b.status)
    || compareStrings(a.oldPath ?? '', b.oldPath ?? '');
}

function compareModuleDelta(a: ModuleDelta, b: ModuleDelta): number {
  return compareStrings(a.module, b.module);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
