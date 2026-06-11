#!/bin/bash
# Wrap the SwiftPM-built FamiliarAvatar binary into a signed FamiliarAvatar.app.
#
# WHY THIS EXISTS (5.4 STT): macOS TCC reads the Microphone / Speech-Recognition
# usage strings ONLY from a real signed .app bundle. A bare `.build/debug/FamiliarAvatar`
# hard-crashes the moment it requests speech auth (proven by the 5.4 spike). So to
# use voice (--wake-word) the overlay must run from this bundle. Everything else
# (tap/long-press gestures, the rendered pet) works fine as a bare CLI; the bundle
# is only needed for the mic.
#
# Bundle.module note: Haru's Live2D renderer loads its Metal shaders via
# Bundle.module. The SwiftPM-generated accessor falls back to a hardcoded absolute
# .build path when it can't find the bundle next to Bundle.main, and that path
# exists on this dev machine — so by-eye dev needs NOTHING copied into the .app
# (the SwiftPM resource bundle has no Info.plist and codesign refuses to seal it
# nested anyway). A fully self-contained, distributable .app — bundling resources
# under a codesign-clean layout — is a DEFERRED packaging concern; this script is
# the by-eye dev wrapper that unlocks the mic, nothing more.
#
# Usage:  ./scripts/build-app.sh [debug|release]   (default debug)
# Output: .build/FamiliarAvatar.app  (gitignored build area)
set -euo pipefail
cd "$(dirname "$0")/.."   # avatar/

CONFIG="${1:-debug}"
BUILD=".build/$CONFIG"
APP=".build/FamiliarAvatar.app"
BUNDLE_ID="com.familiar.avatar"

echo "==> building FamiliarAvatar ($CONFIG)"
swift build --product FamiliarAvatar -c "$CONFIG" >/dev/null

BIN="$BUILD/FamiliarAvatar"
[ -x "$BIN" ] || { echo "FATAL: binary not found at $BIN"; exit 1; }

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/FamiliarAvatar"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>      <string>FamiliarAvatar</string>
    <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>            <string>FamiliarAvatar</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>0.5.4</string>
    <key>LSMinimumSystemVersion</key>  <string>13.0</string>
    <key>LSUIElement</key>             <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Familiar listens for your wake word so you can talk to your desk companion.</string>
    <key>NSSpeechRecognitionUsageDescription</key>
    <string>Familiar transcribes your spoken commands on-device to act on them.</string>
</dict>
</plist>
PLIST

echo "==> ad-hoc signing (sufficient for TCC — proven by the 5.4 spike)"
codesign --force --sign - "$APP" >/dev/null

ABS="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
echo "==> done: $ABS"
echo
echo "Launch (voice ON) — runs in the GUI session so TCC can prompt:"
echo "  open \"$ABS\" --args --character \"\$PWD/characters/haru\" --monitor 0 --wake-word haru"
echo "(grant the Microphone + Speech prompts on first run; logs go to the daemon/Console, not the terminal)"
