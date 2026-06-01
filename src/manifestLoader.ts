import type { ArchitectureManifest, SeparationRule } from './manifest.js';

export const MANIFEST_PATH = '.familiar/manifest.json';

export function parseManifest(raw: string | null): ArchitectureManifest {
  if (raw === null) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!isRecord(parsed)) {
    return {};
  }

  const manifest: ArchitectureManifest = {};

  if (Array.isArray(parsed.protected)) {
    manifest.protected = coerceStringArray(parsed.protected);
  }

  if (Array.isArray(parsed.separate)) {
    manifest.separate = coerceSeparationRules(parsed.separate);
  }

  return manifest;
}

function coerceStringArray(values: unknown[]): string[] {
  const strings: string[] = [];

  for (const value of values) {
    if (isString(value)) {
      strings.push(value);
    }
  }

  return strings;
}

function coerceSeparationRules(values: unknown[]): SeparationRule[] {
  const rules: SeparationRule[] = [];

  for (const value of values) {
    const rule = coerceSeparationRule(value);

    if (rule !== null) {
      rules.push(rule);
    }
  }

  return rules;
}

function coerceSeparationRule(value: unknown): SeparationRule | null {
  if (!isRecord(value) || !isString(value.from) || !isString(value.to)) {
    return null;
  }

  const rule: SeparationRule = {
    from: value.from,
    to: value.to,
  };

  if (isString(value.name)) {
    rule.name = value.name;
  }

  return rule;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
