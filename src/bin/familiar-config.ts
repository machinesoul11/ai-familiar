import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { join } from 'node:path';
import { resolveStateRootFromEnv } from '../daemon.js';
import { computeEffectiveConfig, readSettingsText } from '../effectiveConfig.js';
import { resolveTtsConfig } from '../ttsConfig.js';
import {
  CONFIG_KEYS,
  SECRET_ENV_NAMES,
  WIZARD_STEPS,
  applySetting,
  applyWizardAnswers,
  describeConfig,
  getConfigValue,
  removeSetting,
  upsertEnv,
  validateSecret,
  validateSetting,
  type ConfigKey,
  type ConfigValue,
  type KeyView,
  type SecretName,
} from '../configWrite.js';
import { readEnvText, writeEnvFile, writeSettingsFile } from '../configStore.js';

function main(): void {
  const stateRoot = resolveStateRootFromEnv(process.env);
  loadEnvFiles(stateRoot);

  const command = process.argv[2];
  switch (command) {
    case 'list':
      listConfig(stateRoot);
      return;
    case 'get':
      getConfig(stateRoot, process.argv[3]);
      return;
    case 'set':
      setConfig(stateRoot, process.argv[3], process.argv[4]);
      return;
    case 'unset':
      unsetConfig(stateRoot, process.argv[3]);
      return;
    case 'set-secret':
      setSecret(stateRoot, process.argv[3], process.argv[4]);
      return;
    case 'init':
      void initConfig(stateRoot).catch(() => {
        process.exitCode = 1;
      });
      return;
    default:
      usage();
      process.exitCode = 1;
  }
}

function listConfig(stateRoot: string): void {
  const raw = readSettingsText(stateRoot);
  const views = describeConfig(process.env, raw);
  const width = Math.max(...views.map((view) => view.key.length));

  for (const view of views) {
    console.log(`${view.key.padEnd(width)}  ${formatValue(view.value)}  (${view.source})`);
  }

  console.log(`tts.provider${' '.repeat(Math.max(1, width - 'tts.provider'.length + 2))}${computeEffectiveConfig(process.env, raw).tts.provider}  (effective)`);
  console.log(`elevenlabs.secret${' '.repeat(Math.max(1, width - 'elevenlabs.secret'.length + 2))}${resolveTtsConfig(process.env).provider === 'elevenlabs' ? 'yes' : 'no'}  (boot)`);
}

function getConfig(stateRoot: string, key: string | undefined): void {
  if (typeof key !== 'string') {
    console.error('missing key');
    process.exitCode = 1;
    return;
  }

  const value = getConfigValue(process.env, readSettingsText(stateRoot), key);
  if (value === null) {
    console.error(`unknown key '${key}'`);
    process.exitCode = 1;
    return;
  }

  console.log(formatValue(value));
}

function setConfig(stateRoot: string, key: string | undefined, rawValue: string | undefined): void {
  if (typeof key !== 'string' || typeof rawValue !== 'string') {
    console.error('usage: familiar-config set <key> <value>');
    process.exitCode = 1;
    return;
  }

  const validation = validateSetting(key, rawValue);
  if (!validation.ok) {
    console.error(validation.error);
    process.exitCode = 1;
    return;
  }

  writeSettingsFile(stateRoot, applySetting(readSettingsText(stateRoot), key as ConfigKey, validation.value));
  console.log(`set ${key}`);
}

function unsetConfig(stateRoot: string, key: string | undefined): void {
  if (typeof key !== 'string' || !isConfigKey(key)) {
    console.error(`unknown key '${key ?? ''}'`);
    process.exitCode = 1;
    return;
  }

  writeSettingsFile(stateRoot, removeSetting(readSettingsText(stateRoot), key));
  console.log(`unset ${key}`);
}

function setSecret(stateRoot: string, name: string | undefined, value: string | undefined): void {
  if (typeof name !== 'string' || typeof value !== 'string') {
    console.error('usage: familiar-config set-secret <name> <value>');
    process.exitCode = 1;
    return;
  }

  const validation = validateSecret(name, value);
  if (!validation.ok) {
    console.error(validation.error);
    process.exitCode = 1;
    return;
  }

  writeEnvFile(stateRoot, upsertEnv(readEnvText(stateRoot), { [validation.envName]: validation.value }));
  console.log(`set ${validation.envName}`);
  console.log('Restart the running daemon to pick up this secret.');
}

async function initConfig(stateRoot: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error('init requires an interactive terminal');
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input, output });
  try {
    const raw = readSettingsText(stateRoot);
    const current = new Map<ConfigKey, KeyView>(
      describeConfig(process.env, raw).map((view) => [view.key, view]),
    );
    const answers: Partial<Record<ConfigKey, string>> = {};

    for (const step of WIZARD_STEPS) {
      for (;;) {
        const view = current.get(step.key);
        const suffix = step.choices ? ` [${step.choices.join('/')}]` : '';
        const answer = await rl.question(`${step.prompt}${suffix} (current: ${formatValue(view?.value ?? '')}): `);
        if (answer.trim() === '') {
          break;
        }

        const validation = validateSetting(step.key, answer);
        if (validation.ok) {
          answers[step.key] = answer;
          break;
        }

        console.error(validation.error);
      }
    }

    const result = applyWizardAnswers(raw, answers);
    if (!result.ok) {
      for (const error of result.errors) {
        console.error(`${error.key}: ${error.error}`);
      }
      process.exitCode = 1;
      return;
    }

    writeSettingsFile(stateRoot, result.text);

    if (answers.voice?.trim().toLowerCase() === 'elevenlabs') {
      await promptAndWriteSecret(rl, stateRoot, 'apiKey');
      await promptAndWriteSecret(rl, stateRoot, 'voiceId');
      console.log('Restart the running daemon to pick up these secrets.');
    }

    console.log('wrote settings');
  } finally {
    rl.close();
  }
}

async function promptAndWriteSecret(
  rl: ReturnType<typeof createInterface>,
  stateRoot: string,
  name: SecretName,
): Promise<void> {
  for (;;) {
    const value = await rl.question(`${name} (${SECRET_ENV_NAMES[name]}): `);
    const validation = validateSecret(name, value);
    if (validation.ok) {
      writeEnvFile(stateRoot, upsertEnv(readEnvText(stateRoot), { [validation.envName]: validation.value }));
      console.log(`set ${validation.envName}`);
      return;
    }

    console.error(validation.error);
  }
}

function loadEnvFiles(stateRoot: string): void {
  for (const path of [join(process.cwd(), '.env'), join(stateRoot, '.env')]) {
    try {
      process.loadEnvFile(path);
    } catch {
      // Missing or unreadable env files are ignored.
    }
  }
}

function usage(): void {
  console.error('usage: familiar-config <list|get|set|unset|set-secret|init>');
}

function formatValue(value: ConfigValue): string {
  return String(value);
}

function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

try {
  main();
} catch {
  process.exitCode = 1;
}
