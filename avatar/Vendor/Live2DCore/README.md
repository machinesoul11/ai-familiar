# Live2D Cubism Core (not bundled)

The Live2D Cubism **Core** is **proprietary** (Live2D Proprietary Software License
Agreement — see `LICENSE.md` / `SDK-LICENSE.md` here). Its license permits
redistribution only when the Core is *embedded in a finished application*, **not**
as standalone library files published in a public source repository. So Familiar
does **not** commit the Core — you download it yourself (it's free for this use).

You only need this if you want the **Live2D** renderer. The default avatar uses the
bundled **Spine** sample (`spineboy`) and does not need any of this.

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

3. Build the avatar as usual:

   ```sh
   cd avatar
   swift build --product FamiliarAvatar
   ```

Until both files are in place, the avatar target won't link (it depends on the
Cubism renderer). The Node daemon — Familiar's core — has no dependency on any of
this and builds/tests on its own.
