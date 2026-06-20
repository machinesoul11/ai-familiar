# Live2D Cubism Core (not bundled)

The Live2D Cubism **Core** is **proprietary** (Live2D Proprietary Software License
Agreement — see `LICENSE.md` / `SDK-LICENSE.md` here). Its license permits
redistribution only when the Core is *embedded in a finished application*, **not**
as standalone library files published in a public source repository. So Familiar
does **not** commit the Core — you download it yourself (it's free for this use).

You only need this if you opt into the **Live2D** renderer (`familiar avatar
--live2d` / `FAMILIAR_LIVE2D=1`). The default avatar uses the bundled **Spine**
sample (`spineboy`), builds with **zero downloads**, and does not need any of this
— `Package.swift` excludes the Cubism target entirely unless Live2D is enabled.

## Get it

1. Download the **Cubism SDK for Native** (free):
   <https://www.live2d.com/en/sdk/download/native/> (this repo was built against
   *Cubism SDK for Native 5 R5*).
2. Copy two files out of the downloaded SDK into this checkout:

   | From the SDK | To here |
   |---|---|
   | `Core/lib/macos/arm64/libLive2DCubismCore.a` | `avatar/Vendor/Live2DCore/lib/libLive2DCubismCore.a` |
   | `Core/include/Live2DCubismCore.h`             | `avatar/Sources/CubismLive2D/core/Live2DCubismCore.h` |

   (Both paths are gitignored, so they stay local and are never committed.)

   (Or just run `familiar setup-live2d /path/to/CubismSdkForNative-<version>` and it
   copies both files into place for you.)

3. Build the avatar with Live2D enabled:

   ```sh
   familiar avatar --live2d
   # equivalently, by hand:
   cd avatar && FAMILIAR_LIVE2D=1 swift build --product FamiliarAvatar
   ```

Without `FAMILIAR_LIVE2D=1` the avatar builds spineboy-only and needs none of these
files (the Cubism target is excluded from the package). The Node daemon — Familiar's
core — has no dependency on any of this and builds/tests on its own.
