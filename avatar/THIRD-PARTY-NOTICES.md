# Third-party notices

## spine-cpp (Spine Runtimes) — `Sources/CSpine/spine_include`, `Sources/CSpine/spine_src`

Copyright (c) 2013-2025, Esoteric Software LLC. Vendored from the `4.2` branch of
<https://github.com/EsotericSoftware/spine-runtimes>.

The Spine Runtimes are licensed under the **Spine Runtimes License Agreement**
(<http://esotericsoftware.com/spine-runtimes-license>). Integration is permitted
provided that **each user of the resulting product obtains their own Spine Editor
license**, and that redistribution includes this license and copyright notice. The
full license text is preserved in the header of every vendored source file.

## spineboy sample asset — `Sources/FamiliarAvatar/Resources/spineboy-*`

Copyright (c) Esoteric Software LLC. The spineboy example skeleton/atlas ship with
the Spine Runtimes for evaluation and are subject to the same license. Replace with
your own licensed character for any real distribution.

## Live2D Cubism SDK for Native — `Sources/CubismLive2D/framework`, `Vendor/Live2DCore`

Copyright (c) Live2D Inc. Vendored from the **Cubism SDK for Native 5 R5**
(<https://www.live2d.com/en/sdk/download/native/>). Two licenses apply:

- **`Sources/CubismLive2D/framework`** (the Cubism Native Framework, incl. its Metal
  renderer) — **Live2D Open Software License**
  (<https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html>). The
  full license header is preserved at the top of every vendored source file. One file,
  `Rendering/Metal/CubismShader_Metal.mm`, carries a small marked **Familiar patch**
  (`CubismShaderInject.h`) that runtime-compiles the Metal shaders, because the Command
  Line Tools ship no offline `metallib` compiler.
- **The proprietary Live2D Cubism Core (static library + `Live2DCubismCore.h` header)** —
  **Live2D Proprietary Software License Agreement** (`Vendor/Live2DCore/LICENSE.md`,
  `SDK-LICENSE.md`). These files are **NOT committed to this repository.** Although the
  Core appears on `RedistributableFiles.txt`, the Proprietary License (§5.1, §5.2.1,
  §5.3.2) permits redistribution only when the Core is *embedded in a finished derivative
  application* — not as standalone library files published in a public source repo for
  others to build against. So Familiar ships without the Core: users download the free
  Cubism SDK for Native and drop in two files themselves (see
  `Vendor/Live2DCore/README.md`). Both paths are gitignored.

  Separately, a drop-in load-any-model app is an "Expandable Application" under the
  Cubism license and needs a separate (paid) Live2D business license for distribution —
  a release-time matter, not required for personal/local use.

The Cubism **sample models** (e.g. Haru) ship under the Live2D Free Material License and
are **not** committed to this repository (see `.gitignore`); the production character is
purchased separately and lives outside the repo.
