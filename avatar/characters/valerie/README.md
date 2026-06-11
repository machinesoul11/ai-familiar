# Valerie character pack

Drop the three Spine assets next to `valerie.config.json` in this folder:

```
avatar/characters/valerie/
  valerie.config.json   ← already here (the token → animation mapping)
  valerie-pro.skel      ← TODO: rig + export from Spine editor
  valerie.atlas         ← TODO
  valerie.png           ← TODO (named by the .atlas)
```

Then run:

```sh
avatar/.build/debug/FamiliarAvatar --character avatar/characters/valerie
```

(or copy the folder to `$FAMILIAR_HOME/character/` to make it the default with no flag).

## Asset requirements (hard)

- **Exported from Spine editor 4.2.x** — the runtime is spine-cpp 4.2; other major
  versions won't load.
- **Premultiplied-alpha atlas preferred** (`pma: true`). Straight-alpha also works
  (the renderer auto-detects and compensates), but PMA composites cleanest over the
  transparent overlay.
- **Animation names must match `valerie.config.json`**: `idle`, `typing`,
  `concerned`, `smile`, `standby`, `wave`, `thinking`, `alert`. (Rename either side
  to match — a state whose animation is missing is silently skipped.)

## Rig spec (for the Spine artist)

Anime-style female assistant: long red-orange hair w/ straight bangs, golden amber
eyes, navy business suit, white shirt, dark blue tie. Separate, cleanly-weighted
parts: head, torso, upper arms, forearms, hands, hair layers, eyes, eyelids, mouth
shapes, tie, suit jacket, shirt collar.

Animations: **idle** (relaxed breathing, blink, subtle hair motion) · **typing**
(working) · **concerned** (blocked — hand near chin/tie) · **smile** (done) ·
**standby** (ready — attentive neutral) · **wave** (happy) · **thinking** (eyes up,
hand near chin) · **alert** (focused, sharper posture).
