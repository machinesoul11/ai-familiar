# Familiar — agent guide

Ambient-awareness companion for long-running Claude Code sessions. A local,
zero-dependency Node/TypeScript daemon (driven by Claude Code lifecycle hooks)
plus an optional native macOS Swift/Metal desk-pet avatar. macOS-only. See
[README.md](README.md) for the user-facing overview.

## Build, test, run

```sh
npm install        # dev/build tooling only — the daemon has ZERO runtime deps
npm run build      # tsc → dist/  (hooks invoke dist/bin/*.js, so build before enabling)
npm test           # full Vitest suite (pretest builds first); must stay green
```

- **Node 22.5+ required** — the daemon uses the built-in `node:sqlite`.
- Tests import the **compiled** output under `dist/`, not the `.ts` sources.
- The Swift avatar lives in [`avatar/`](avatar/) and builds separately
  (`cd avatar && swift build`); it is outside the Vitest loop and verified by eye.

## Layout

- `src/` — daemon + pure logic modules (TypeScript, ESM/NodeNext). Compiled to `dist/`.
- `src/bin/` — the CLIs: `familiar-daemon`, `familiar-hook`, `familiar-config`,
  `familiar-recap`, `familiar-recall`, `familiar-stop`.
- `hooks/hooks.json` — registers the Claude Code lifecycle hooks (SessionStart, Stop,
  SubagentStop, Notification, SessionEnd) → `node dist/bin/familiar-hook.js <event>`.
- `.claude-plugin/plugin.json` — the Claude Code plugin manifest.
- `test/` — Vitest specs, one per `src/` module.
- `avatar/` — native Swift/AppKit/Metal overlay + vendored spine-cpp and Live2D
  Cubism SDK (third-party; see `avatar/THIRD-PARTY-NOTICES.md`).

## Pipeline (how the daemon works)

hook event → **normalize** → **attention routing** (silent / ambient / interrupt) →
**decision ledger** (`node:sqlite`) → **architecture recap** ("the moat": diff +
import-graph delta evaluated against an optional `.familiar/manifest.json`) →
**deliver** (voice via `say`/ElevenLabs + the avatar command stream).

## Conventions to preserve

- **Zero runtime dependencies.** `package.json` has no `dependencies`. Keep it that
  way — use Node built-ins and macOS system tools only.
- **No-shell subprocess spawning.** Every `say`/`afplay`/`osascript`/`git` call uses
  an argv array, never a shell string. Do not introduce shell interpolation of any
  text that originates from transcripts, file paths, or recap content.
- **All local state lives under `$FAMILIAR_HOME`** (default `~/.familiar`): settings,
  the decision ledger, the recap snapshot, sockets, and the `.env` secret. Nothing is
  written outside that root. Deleting it removes Familiar entirely.
- **Secrets never enter the repo.** `.env` is gitignored; the canonical location is
  `$FAMILIAR_HOME/.env`. The only outbound network call is opt-in ElevenLabs.
- **Local-only sockets.** `daemon.sock` / `avatar.sock` / `intent.sock` are
  filesystem sockets under `$FAMILIAR_HOME`, never TCP. Parse inbound JSON defensively.
- **Pure core, thin I/O edges.** Logic modules are pure and unit-tested; the real
  git/fs/network adapters are kept at the entrypoints. Add behavior as a pure module
  with tests, then wire it at the edge.

## Gotchas

- Hooks are inert until `npm run build` produces `dist/bin/*.js`.
- The avatar ships the `spineboy` Spine sample (the default). The Haru Live2D sample
  is **not** bundled (Live2D Free Material License) — download separately.
- The Live2D Cubism renderer is **opt-in** (`FAMILIAR_LIVE2D=1`, i.e.
  `familiar avatar --live2d`). The default `swift build --product FamiliarAvatar`
  is **spineboy-only and needs no downloads** — `Package.swift` excludes the
  `CubismLive2D` target entirely when the env flag is unset, and the two Cubism
  source files are wrapped in `#if LIVE2D`. The proprietary **Live2D Cubism Core**
  (`.a` + `Live2DCubismCore.h`) is **not** committed (license forbids standalone
  redistribution; both paths gitignored); only the `--live2d` build needs it — get
  it via `familiar setup-live2d <sdk>` (see `avatar/Vendor/Live2DCore/README.md`).
  The Node daemon needs none of it.
- macOS-specific: voice talk-back (STT) needs a signed `.app` (TCC); see
  `avatar/scripts/build-app.sh`. `osascript` notification banners are dead on macOS 26.
