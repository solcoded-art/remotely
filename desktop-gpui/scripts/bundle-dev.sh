#!/bin/sh
# Builds a development bundle, target/Mac Remote GPUI.app, so macOS grants Screen
# Recording and Accessibility to this app instead of to the terminal that launched it.
# Not for distribution (no Developer ID, not notarized).
#
# Signing: uses the local "Mac Remote GPUI Dev" certificate when it is in your
# keychain (or $MAC_REMOTE_SIGN_IDENTITY), so permissions and Keychain "Always Allow"
# survive rebuilds. Without one it signs ad-hoc, and every rebuild looks like a new
# app to macOS: permissions must be granted again and Keychain asks again.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/.." && pwd)
app="$here/target/Mac Remote GPUI.app"

[ -x "$repo/bin/mac_driver" ] || (cd "$repo" && npm run build:driver)
(cd "$here" && cargo build --release)

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/target/release/mac-remote" "$app/Contents/MacOS/mac-remote"
cp "$repo/bin/mac_driver" "$app/Contents/Resources/mac_driver"
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$here/Cargo.toml" | head -1)
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>app.enftify.macremote.gpui.dev</string>
  <key>CFBundleName</key><string>Mac Remote GPUI</string>
  <key>CFBundleDisplayName</key><string>Mac Remote GPUI</string>
  <key>CFBundleExecutable</key><string>mac-remote</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
identity=${MAC_REMOTE_SIGN_IDENTITY:-}
if [ -z "$identity" ] && security find-identity -p codesigning | grep -q '"Mac Remote GPUI Dev"'; then
  identity=$(security find-identity -p codesigning | sed -n 's/.*) \([0-9A-F]\{40\}\) "Mac Remote GPUI Dev".*/\1/p' | head -1)
fi
identity=${identity:--}
codesign --force --sign "$identity" --identifier app.enftify.macremote.gpui.driver "$app/Contents/Resources/mac_driver"
codesign --force --sign "$identity" "$app"
codesign --verify "$app"
[ "$identity" = "-" ] && echo "Signed ad-hoc: grant permissions again after each rebuild." || echo "Signed with $identity"
echo "Built $app"
