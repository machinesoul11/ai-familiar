#!/usr/bin/env node
// Familiar — the single launch command.
//
//   familiar avatar            launch the desk-pet overlay
//   familiar config set …      read/write settings + the ElevenLabs secret
//   familiar recap | recall    replay the latest recap / "while you were away"
//   familiar stop              silence her mid-sentence
//   familiar setup-live2d <p>  drop the free Cubism Core files into place
//   familiar doctor            show what's set up
//
// Installed globally via `npm link` (package.json `bin`). The repo root is
// resolved from THIS file's real location, so it keeps working through the
// npm-link symlink no matter the cwd.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const REPO = dirname(dirname(fileURLToPath(import.meta.url))); // bin/familiar.js → repo root
const DIST_BIN = join(REPO, 'dist', 'bin');
const AVATAR = join(REPO, 'avatar');

// The two proprietary Cubism Core files (gitignored — never committed).
const CUBISM_HEADER = join(AVATAR, 'Sources', 'CubismLive2D', 'core', 'Live2DCubismCore.h');
const CUBISM_LIB = join(AVATAR, 'Vendor', 'Live2DCore', 'lib', 'libLive2DCubismCore.a');

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO, ...opts });
}

function die(msg, code = 1) {
  console.error(`familiar: ${msg}`);
  process.exit(code);
}

// Build the daemon to dist/ if it isn't there yet (first run after a clone).
function ensureBuilt() {
  if (existsSync(join(DIST_BIN, 'familiar-config.js'))) return;
  console.error('familiar: building the daemon (first run)…');
  const r = sh('npm', ['run', 'build']);
  if (r.status !== 0) die('build failed — run `npm install` then `npm run build` to see the error.', r.status ?? 1);
}

// Hand a subcommand straight to one of the dist bins, inheriting stdio + exit code.
function proxy(binName, args) {
  ensureBuilt();
  const r = sh('node', [join(DIST_BIN, binName), ...args]);
  process.exit(r.status ?? 0);
}

// ── avatar ────────────────────────────────────────────────────────────────
function avatar(args) {
  ensureBuilt(); // so the menubar pane's --config-cmd target exists

  const live2d = args.includes('--live2d');
  const release = args.includes('--release');
  const passthrough = args.filter((a) => a !== '--live2d' && a !== '--release');

  // The DEFAULT build is spineboy-only and needs no downloads. Live2D is opt-in
  // (--live2d) and is the only path that requires the proprietary Cubism Core.
  if (live2d && (!existsSync(CUBISM_HEADER) || !existsSync(CUBISM_LIB))) {
    console.error(`familiar: --live2d needs the free Live2D Cubism Core, which isn't bundled
(its license forbids redistributing it in a public repo). One-time setup:

  1. Download the Cubism SDK for Native (free):
       https://www.live2d.com/en/sdk/download/native/
  2. Unzip it, then run:
       familiar setup-live2d /path/to/CubismSdkForNative-<version>
  3. familiar avatar --live2d

(Plain \`familiar avatar\` needs none of this — it renders the bundled spineboy
Spine sample.) Missing right now:`);
    if (!existsSync(CUBISM_HEADER)) console.error(`     ${CUBISM_HEADER}`);
    if (!existsSync(CUBISM_LIB)) console.error(`     ${CUBISM_LIB}`);
    process.exit(1);
  }

  // tokenizeConfigCmd (Swift) splits the config command on whitespace, so the
  // repo path must be space-free for the menubar settings pane to find the CLI.
  let configCmd = null;
  if (REPO.includes(' ')) {
    console.error(`familiar: repo path has spaces (${REPO}); the settings pane will be read-only.`);
  } else {
    configCmd = `node ${join(DIST_BIN, 'familiar-config.js')}`;
  }

  const variant = release ? 'release' : 'debug';
  // FAMILIAR_LIVE2D=1 flips the Package.swift manifest to pull in the Cubism
  // target + the LIVE2D compile flag; absent, the build is spineboy-only.
  const buildEnv = live2d ? { ...process.env, FAMILIAR_LIVE2D: '1' } : process.env;

  console.error(`familiar: building the avatar (${variant}${live2d ? ', Live2D' : ', spineboy'})…`);
  const build = sh('swift', ['build', ...(release ? ['-c', 'release'] : []), '--product', 'FamiliarAvatar'], { cwd: AVATAR, env: buildEnv });
  if (build.status !== 0) die('swift build failed (see output above).', build.status ?? 1);

  const exe = join(AVATAR, '.build', variant, 'FamiliarAvatar');
  const launchArgs = [...passthrough];
  if (configCmd) launchArgs.push('--config-cmd', configCmd);

  console.error(`familiar: launching the avatar — ⌃⌥⌘Q to quit, double-click her to engage.\n`);
  const child = spawn(exe, launchArgs, { stdio: 'inherit', cwd: AVATAR });
  child.on('error', (err) => die(`couldn't launch the avatar (${exe}): ${err.message}`));
  child.on('exit', (code) => process.exit(code ?? 0));
}

// ── setup-live2d ────────────────────────────────────────────────────────────
// Recursively find a file by exact name under a root (skips heavy build dirs).
// `require`: only accept matches whose path contains this substring (e.g. the
// arch dir — never silently copy a wrong-arch lib). `prefer`: rank, not require.
function findFile(root, name, { prefer, require } = {}) {
  let best = null;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        walk(p);
      } else if (e.name === name) {
        if (require && !p.includes(require)) continue; // wrong arch / location — skip
        if (!best || (prefer && p.includes(prefer))) best = p;
      }
    }
  };
  walk(root);
  return best;
}

function setupLive2d(args) {
  const src = args[0];
  if (!src) die('usage: familiar setup-live2d /path/to/CubismSdkForNative-<version>');
  if (!existsSync(src) || !statSync(src).isDirectory()) die(`not a directory: ${src}`);

  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  // The lib MUST match this machine's arch — require the arch dir so a wrong-arch
  // copy fails here with a clear message, not later as a cryptic link error.
  const lib = findFile(src, 'libLive2DCubismCore.a', { require: `/macos/${arch}/` });
  const header = findFile(src, 'Live2DCubismCore.h', { prefer: '/include/' });

  if (!lib) die(`couldn't find a ${arch} libLive2DCubismCore.a under ${src}
  expected …/Core/lib/macos/${arch}/libLive2DCubismCore.a — is this the unzipped
  Cubism SDK for Native, and does it ship a ${arch} slice for this Mac?`);
  if (!header) die(`couldn't find Live2DCubismCore.h under ${src}\n  expected …/Core/include/Live2DCubismCore.h`);

  mkdirSync(dirname(CUBISM_LIB), { recursive: true });
  mkdirSync(dirname(CUBISM_HEADER), { recursive: true });
  copyFileSync(lib, CUBISM_LIB);
  copyFileSync(header, CUBISM_HEADER);

  console.error(`familiar: Cubism Core installed (${arch}, gitignored — stays local):
  ${lib}
    → ${CUBISM_LIB}
  ${header}
    → ${CUBISM_HEADER}

Now run:  familiar avatar --live2d`);
}

// ── doctor ──────────────────────────────────────────────────────────────────
function doctor() {
  const ok = (b) => (b ? '✓' : '✗');
  const built = existsSync(join(DIST_BIN, 'familiar-config.js'));
  const cubism = existsSync(CUBISM_HEADER) && existsSync(CUBISM_LIB);
  const home = process.env.FAMILIAR_HOME || join(process.env.HOME || '~', '.familiar');
  console.error(`Familiar — ${REPO}
  ${ok(built)} daemon built (dist/bin)          ${built ? '' : '→ run any command to build, or `npm run build`'}
  ${ok(existsSync(home))} state root ${home}
  ${cubism ? '✓' : '·'} Live2D Cubism Core         ${cubism ? '(present — `familiar avatar --live2d` available)' : '(optional, only for `familiar avatar --live2d`; install via `familiar setup-live2d <sdk>`)'}
  node ${process.version}

The default \`familiar avatar\` (spineboy) needs no Cubism download.`);
}

function help() {
  console.error(`familiar — ambient companion for long-running coding sessions

  familiar avatar [--monitor N …]               launch the desk pet (spineboy, no downloads)
  familiar avatar --live2d                      … with the optional Live2D renderer
  familiar config <list|get|set|unset|set-secret|init> …   settings + secret
  familiar recap                                replay the latest recap
  familiar recall                               the "while you were away" rollup
  familiar stop                                 silence her mid-sentence
  familiar setup-live2d <sdk-dir>               install the free Cubism Core (for --live2d)
  familiar doctor                               show what's set up

Examples:
  familiar config set voice elevenlabs
  familiar config set-secret apiKey <key>
  familiar avatar --monitor 1

The default avatar renders the bundled spineboy Spine sample and needs no
proprietary downloads. Live2D (--live2d) is opt-in and requires the free
Cubism Core (familiar setup-live2d).

The daemon itself runs automatically from Claude Code's lifecycle hooks; see
the README for enabling the plugin.`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'avatar': avatar(rest); break;
  case 'config': proxy('familiar-config.js', rest); break;
  case 'recap': proxy('familiar-recap.js', rest); break;
  case 'recall': proxy('familiar-recall.js', rest); break;
  case 'stop': proxy('familiar-stop.js', rest); break;
  case 'build': ensureBuilt(); console.error('familiar: daemon built. For the avatar: `familiar avatar`.'); break;
  case 'setup-live2d': setupLive2d(rest); break;
  case 'doctor': doctor(); break;
  case undefined:
  case 'help':
  case '--help':
  case '-h': help(); break;
  default: die(`unknown command "${cmd}". Run \`familiar help\`.`);
}
