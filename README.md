# Coding Companion

An ambient awareness companion for long-running, multi-agent coding sessions.

When an AI coding agent is working for minutes at a time and your attention is
elsewhere, Coding Companion keeps you lightly informed of what's happening and
gives you a useful recap when the run lands — so you can step away without
losing the thread.

> ⚠️ **Early development — not yet released.**
> This is a work in progress and not ready for use. Structure and behaviour will
> change. Open-source licensing and a proper release will follow once it has been
> fully tested and is working end to end.

## Status

- Local companion daemon (TypeScript / Node) — in progress.
- Native macOS desk-pet avatar (Swift / AppKit / Metal) — in progress.

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
familiar-config set avatar.scale 1.25
familiar-config set-secret apiKey <key>
familiar-config init        # first-run wizard
```

The pane only writes when it knows where that CLI is: launch the avatar with
`--config-cmd "node /abs/path/to/dist/bin/familiar-config.js"` (or set the
`FAMILIAR_CONFIG` env var). Without it, the menu is read-only.

All settings are stored under `$FAMILIAR_HOME` (default `~/.familiar`):
`settings.json` for preferences and `.env` for the ElevenLabs secret — one
removable root, deleted on uninstall.

## Development

Requires Node.js 22.5+ (developed on Node 26) — the daemon uses the built-in
`node:sqlite` module.

```sh
npm install
npm test
```

## License

To be determined before public release.
