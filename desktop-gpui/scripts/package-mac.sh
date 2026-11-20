#!/bin/sh
# Builds the release package of Mac Remote (GPUI): target/dist/Mac Remote.app and
# target/dist/MacRemote-<version>-mac-arm64.zip. It replaces the Electron app:
# same name and bundle identifier (com.macremote.companion), Apple Silicon,
# macOS 13+. Like the Electron 0.3.x releases it is ad-hoc signed and not
# notarized (developer beta). Publishing the zip and pointing release.config.json
# at it are separate, manual steps; see docs/gpui-desktop.md.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/.." && pwd)
dist="$here/target/dist"
app="$dist/Mac Remote.app"
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$here/Cargo.toml" | head -1)
zip="$dist/MacRemote-$version-mac-arm64.zip"

[ "$(uname -m)" = arm64 ] || { echo "Build on Apple Silicon." >&2; exit 1; }
(cd "$repo" && npm run build:driver >/dev/null)
(cd "$here" && MAC_REMOTE_CHANNEL=release cargo build --release)

rm -rf "$dist"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/target/release/mac-remote" "$app/Contents/MacOS/Mac Remote"
cp "$repo/bin/mac_driver" "$app/Contents/Resources/mac_driver"

# App icon from the brand artwork (same source as the Electron build).
iconset="$dist/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size "$repo/public/icons/icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$repo/public/icons/icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"
rm -rf "$iconset"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.macremote.companion</string>
  <key>CFBundleName</key><string>Mac Remote</string>
  <key>CFBundleDisplayName</key><string>Mac Remote</string>
  <key>CFBundleExecutable</key><string>Mac Remote</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSScreenCaptureUsageDescription</key><string>Share your selected Mac display with your signed-in iPhone.</string>
  <key>NSAccessibilityUsageDescription</key><string>Control your Mac from an approved remote session.</string>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" >/dev/null

# Inside-out ad-hoc signatures with the hardened runtime; no entitlements are needed.
codesign --force --options runtime --sign - --identifier com.macremote.companion.driver "$app/Contents/Resources/mac_driver"
codesign --force --options runtime --sign - "$app"
codesign --verify --deep --strict "$app"
[ "$(lipo -archs "$app/Contents/MacOS/Mac Remote")" = arm64 ]
[ "$(lipo -archs "$app/Contents/Resources/mac_driver")" = arm64 ]

ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
shasum -a 256 "$zip" | tee "$zip.sha256"
echo "Built $zip"
