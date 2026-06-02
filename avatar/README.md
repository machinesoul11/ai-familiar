# FamiliarAvatar (Phase 4.2b)

The native macOS desk-pet overlay — the renderer half of Familiar's avatar. It is
a borderless, transparent, always-on-top window (drawing over true-fullscreen apps
via `CGShieldingWindowLevel` + `[.canJoinAllSpaces, .fullScreenAuxiliary]`, proven
by the Phase 0.1 spike) that renders an animated **spineboy** Spine character and
reacts to the daemon's avatar command stream.

This is a separate **polyglot** sub-project: native Swift/AppKit/Metal + vendored
spine-cpp. It is **outside** the zero-dependency Node daemon and outside the
three-LLM Vitest loop — verified by eye, by hand-driving frames into the socket.

## Architecture

```
daemon (4.2c, later)                 this app (4.2b)
  ChannelMessage                       SocketSubscriber  ── reads avatar.sock, splits on '\n'
  → createAvatarChannel                  → AvatarCommand  ── JSON decode (forward-compatible)
  → createAvatarBackend                  → SpineModel     ── semantic token → spineboy animation
  → FrameSink.write ── NDJSON ──▶ avatar.sock              (the renderer-side mapping)
                                         → CSpine bridge  ── spine-cpp, emits flat mesh buffers
                                         → MetalSpineRenderer ── premultiplied-alpha draw
```

- `Sources/CSpine/` — vendored spine-cpp 4.2 + a pure-C bridge (`spine_bridge.h/.cpp`).
  Only `spine_bridge.h` is Swift-visible; spine-cpp's C++ headers never reach Swift.
- `Sources/FamiliarAvatar/` — the AppKit/Metal app.
  - `AvatarCommand.swift` — decodes the NDJSON wire frames (`encodeAvatarCommand`).
  - `SocketSubscriber.swift` — Unix-socket client with reconnect backoff.
  - `SpineModel.swift` — **the token→animation mapping** (renderer-owned, per the protocol).
  - `MetalSpineRenderer.swift` — runtime-compiled Metal shaders, PMA blending.
  - `OverlayWindow.swift` — the borderless always-on-top transparent window + drag.
  - `main.swift` — args, screen placement, hotkeys, wiring.

### Semantic token → spineboy mapping (in `SpineModel`)

| token | spineboy animation |
|-------|--------------------|
| phase `idle`    | `idle` (loop)   |
| phase `working` | `walk` (loop)   |
| phase `blocked` | `aim` (loop)    |
| phase `done`    | `idle` (loop)   |
| `ready: true`   | `jump` (one-shot attention beacon) |
| mood `happy`    | `jump` (one-shot)     |
| mood `thinking` | `idle-turn` (one-shot)|
| mood `alert`    | `shoot` (one-shot)    |
| mood `neutral`  | (no overlay)          |
| `thought`       | ignored (display is Phase 4.3) |

## Build & run

```sh
cd avatar
swift build                       # compiles spine-cpp + the app
.build/debug/FamiliarAvatar       # launches the overlay (monitor-2, interactive)
```

Options: `--socket <path>` (default `$FAMILIAR_HOME/avatar.sock`), `--monitor <n>`
(0-based, default 1), `--size <points>` (default 360), `--click-through`.

Hotkeys (global — need Accessibility permission; otherwise work while the app is
focused): **⌃⌥⌘P** toggle click-through (pet mode), **⌃⌥⌘Q** quit. Drag the
character to reposition when not in click-through.

## Hand-driving (by-eye verification)

From the repo root, in one terminal start the driver (it owns `avatar.sock` and
pushes frames through the real 4.1 + 4.2a pipeline — byte-identical to the future
daemon output):

```sh
npx tsx scripts/avatar-drive.ts          # interactive
npx tsx scripts/avatar-drive.ts --seq    # run the scripted demo first
```

In another terminal launch the overlay (`.build/debug/FamiliarAvatar`). Then type
`seq`, or `state working`, `state blocked ready`, `expression alert`,
`thought hello`, `quit`. Both default to `$FAMILIAR_HOME/avatar.sock`.

## Status

4.2b ships the renderer + transport client. Daemon **wiring (4.2c)** — starting the
publish socket in the daemon, registering the `'visual'` channel in `dispatch.ts`,
and mapping daemon signals → `AvatarCommand` — is deliberately deferred.
