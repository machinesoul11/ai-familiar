# Familiar

**An ambient-awareness companion for long-running, multi-agent coding sessions.**

When an AI coding agent works for minutes at a time and your attention is
elsewhere, Familiar keeps you lightly informed of what's happening — and gives you
a genuinely useful recap when the run lands — so you can step away without losing
the thread.

It runs as a **Claude Code plugin** backed by a local, zero-dependency daemon, with
an optional native macOS **desk-pet avatar** that reacts to what the agent is doing.

> **Status: v1 — functional end to end.** macOS-only, built for personal use and
> released as open source under the MIT license (see [License](#license)). Expect
> some rough edges in setup.

---

## What it does

- **Warm ambient awareness.** While you work in another window, Familiar gives you
  a light sense of what the agent is doing — without you having to look.
- **Interrupts only when it matters.** It speaks up for the things you actually
  need to act on — the agent is blocked or needs you, or a run just finished — and
  stays quiet otherwise.
- **A recap that's worth hearing.** When a run lands, Familiar tells you *which
  modules changed* and flags the architectural things you'd otherwise miss: new
  cross-module coupling, and boundary or protected-zone violations against an
  optional architecture manifest. It blends that with a short gist of the agent's
  final message.
- **Voice, your way.** Free, built-in macOS speech by default; optional ElevenLabs
  for a nicer voice. The recap can also be spoken in Spanish, French, German, or
  Japanese.
- **Talk back to it.** Tap the avatar, press a hotkey, or (optionally) speak to
  replay the last recap or get a "while you were away" rollup — or to cut it off
  mid-sentence.
- **A desk pet that reflects the work.** An optional transparent macOS overlay
  (Live2D or Spine) idles, works, and flags blocks through expression and motion,
  and can show the agent's silent "inner thoughts" in a bubble.

---

## How it works

```
Claude Code  ──hooks──▶  familiar-hook  ──socket──▶  familiar-daemon  ──▶  voice (say / ElevenLabs)
 (SessionStart, Stop,                                     │                └─▶  avatar overlay (Haru)
  SubagentStop,                                           │
  Notification,            normalize → attention routing → decision ledger
  SessionEnd)                       → architecture recap ("the moat")
                                    → delivery
```

Familiar registers Claude Code lifecycle **hooks** (see `hooks/hooks.json`). On
`SessionStart` it ensures the daemon is running (`familiar-daemon --ensure`) and
forwards the event; every later event is forwarded to the daemon over a Unix
socket. The **daemon** is the single source of truth and does all the work:

1. **Normalize** each hook event into a uniform shape.
2. **Route attention** — decide whether an event is silent, ambient, or a
   hard interrupt (you're needed / a run finished).
3. **Ledger** decisions to an append-only local store (`node:sqlite`).
4. **Architectural recap (the "moat")** — diff the working tree, compute the
   import-graph delta, and evaluate both against an optional architecture manifest
   to surface new couplings and boundary/protected-zone crossings.
5. **Deliver** — speak the result through the chosen voice backend, and drive the
   avatar's state/expression/thought stream.

The daemon has **zero runtime dependencies** — only Node built-ins (`fetch`,
`node:sqlite`, …) and macOS system tools (`say`, `afplay`, `osascript`).

---

## Requirements

- **macOS** (the avatar and voice use `say` / `afplay` / `osascript`; on-device
  speech recognition uses Apple's Speech framework).
- **Node.js 22.5+** — the daemon uses the built-in `node:sqlite` module.
- **Claude Code** — Familiar plugs into its hook lifecycle.
- For the avatar: the **Xcode Command Line Tools** (to build the Swift app).

---

## Setup

```sh
git clone https://github.com/machinesoul11/ai-familiar.git
cd ai-familiar
npm install        # dev/build tooling only — the daemon itself has no runtime deps
npm run build      # compile TypeScript → dist/
```

Familiar ships as a **Claude Code plugin** (`.claude-plugin/plugin.json` +
`hooks/hooks.json`). Run `npm run build` **before** enabling it — the hooks invoke
the compiled `dist/bin/*.js`, so the plugin is inert until the build exists. Once
it's enabled in Claude Code, the hooks register automatically and the daemon starts
itself on the next `SessionStart` — there's nothing to run by hand. After that,
just use Claude Code normally; Familiar narrates ambient activity and speaks the
recap when a run lands.

All of Familiar's state lives under one removable root, **`$FAMILIAR_HOME`**
(default `~/.familiar`) — delete it and nothing is left behind.

---

## Settings

Settings live in a **menu bar item** — look for **✦ Familiar** at the top-right of
your screen (next to the clock/battery), **not** in the terminal. If it's hidden
behind a crowded menu bar or the notch, press **⌃⌥⌘S** to pop the same menu up at
your cursor.

From there you can change the voice provider, recap language, the proactive /
voice-talk-back (STT) / stop toggles, and the avatar's size, monitor, and
character.

- **Voice, language, and the toggles apply live** — the daemon re-reads them on
  its next event, no restart needed.
- **Appearance (size / monitor / character) applies on relaunch** — these are read
  once at launch, so changing one offers a one-click **Relaunch now**.
- **ElevenLabs key** — "Set ElevenLabs key…" stores it to `$FAMILIAR_HOME/.env`
  (mode `0600`, never echoed); restart the daemon to pick it up.

Under the hood the pane shells out to the **`familiar-config`** CLI, so all
validation lives in one place. You can use that CLI directly too:

```sh
familiar-config list
familiar-config set voice elevenlabs
familiar-config set recapLang ja
familiar-config set avatar.scale 1.25
familiar-config set-secret apiKey <key>
familiar-config init        # first-run wizard
```

(Run these as `node dist/bin/familiar-config.js …` from the repo, or wire up a
shortcut.) The menu bar pane only writes when it knows where that CLI is: launch
the avatar with `--config-cmd "node /abs/path/to/dist/bin/familiar-config.js"` (or
set the `FAMILIAR_CONFIG` env var). Without it, the menu is read-only.

Settings are stored under `$FAMILIAR_HOME`: `settings.json` for preferences and
`.env` for the ElevenLabs secret. Secrets are never written into the repo
(`.env` is gitignored); the canonical location is `$FAMILIAR_HOME/.env`.

---

## The avatar (optional desk pet)

The voice + recap core works without it, but Familiar can also render a native,
transparent, always-on-top macOS overlay that reacts to the agent's state. A
**Spine** sample character (`spineboy`) is **bundled**, so the overlay renders out
of the box:

```sh
cd avatar
swift build --product FamiliarAvatar
.build/debug/FamiliarAvatar --monitor 0 \
  --config-cmd "node /abs/path/to/dist/bin/familiar-config.js"
# renders the bundled spineboy Spine sample by default
```

**Want the Live2D look (Haru)?** The free Haru Cubism sample is **not** bundled —
it ships under Live2D's Free Material License and is kept out of this repo. Download
it from [Live2D](https://www.live2d.com/en/learn/sample/), drop it into
`avatar/characters/haru/`, then launch with `--character "$PWD/characters/haru"`.
See [`avatar/characters/valerie/`](avatar/characters/valerie/) for how to wire up
your own commissioned Spine character via a `*.config.json`.

Interacting with her (she's **click-through by default**, so your clicks reach the
apps behind her):

- **Double-click** her to engage, then **drag** to reposition (auto-releases after
  a few seconds).
- **Tap** her to replay the last recap — or to **stop** her if she's mid-sentence.
- **Long-press** (~0.5 s) for the "while you were away" activity rollup.
- **Hotkeys:** **⌃⌥⌘S** settings · **⌃⌥⌘P** lock engaged · **⌃⌥⌘Q** quit.

**Voice talk-back (optional, off by default)** uses on-device speech recognition,
which macOS only allows from a signed `.app`. Build one with
`avatar/scripts/build-app.sh` and launch with a wake word; then you can simply
*say* "recap", "what did I miss", or "stop". Nothing is sent off-device.

See [`avatar/README.md`](avatar/README.md) for the renderer internals and
hand-driving the overlay.

---

## Companion tools

Standalone CLIs (run as `node dist/bin/<name>.js`), also reachable via the avatar's
gestures/voice:

| Tool | What it does |
|------|--------------|
| `familiar-daemon` | The companion daemon (`--ensure` starts it if not already running). |
| `familiar-config` | Read/write settings + the ElevenLabs secret (the settings pane's backend). |
| `familiar-recap`  | Replay the latest landed recap, fuller. |
| `familiar-recall` | The "while you were away" activity rollup. |
| `familiar-stop`   | Silence the voice immediately (barge-in). |
| `familiar-hook`   | Internal — forwards a Claude Code hook event to the daemon. |

---

## Privacy

Everything runs locally. Speech recognition is **on-device** (Apple Speech). The
only optional network call is to **ElevenLabs**, and only if you set an API key.
All state — settings, the decision ledger, the recap snapshot, secrets — lives
under `$FAMILIAR_HOME` and is deleted when you remove that directory.

---

## Development

```sh
npm install
npm test           # full suite (Vitest)
npm run build      # tsc → dist/
```

The daemon is pure TypeScript (ESM / NodeNext) with no runtime dependencies; tests
import the compiled output. The avatar is a separate Swift/AppKit/Metal SwiftPM
project under `avatar/` (built and verified separately from the Node test suite).

---

## License

Familiar's own source code is released under the **MIT license** — see
[`LICENSE`](LICENSE).

The optional macOS avatar bundles third-party runtimes under their own separate
terms (these are **not** covered by the MIT license): the **Spine Runtimes** and
the **spineboy** sample asset (Esoteric Software — evaluation use; each user must
obtain their own Spine Editor license), and the **Live2D Cubism** Core + Native
Framework (Live2D Inc. — proprietary / Open Software License). Notably, shipping a
Live2D "Expandable Application" that loads arbitrary Cubism models for distribution
may require a separate paid Live2D license. Full details, copyright notices, and
links are in [`avatar/THIRD-PARTY-NOTICES.md`](avatar/THIRD-PARTY-NOTICES.md).
