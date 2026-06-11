#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS package repair is only supported on Darwin." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/web/src-tauri/target/release/bundle"
APP_PATH="${POSTDOC_MACOS_APP_PATH:-}"
DMG_PATH="${POSTDOC_MACOS_DMG_PATH:-}"
SIGN_IDENTITY="${POSTDOC_MACOS_SIGN_IDENTITY:--}"

if [ -z "$APP_PATH" ]; then
  APP_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -type d -name "*.app" -print -quit 2>/dev/null || true)"
fi

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "Could not find a generated .app bundle under $BUNDLE_DIR/macos." >&2
  exit 1
fi

if [ -z "$DMG_PATH" ]; then
  DMG_PATH="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -type f -name "*.dmg" -print -quit 2>/dev/null || true)"
fi

if [ -z "$DMG_PATH" ]; then
  app_name="$(basename "$APP_PATH" .app)"
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist")"
  arch="$(uname -m)"
  mkdir -p "$BUNDLE_DIR/dmg"
  DMG_PATH="$BUNDLE_DIR/dmg/${app_name// /_}_${version}_${arch}.dmg"
fi

echo "Signing app bundle: $APP_PATH"
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
codesign --force --deep --sign "$SIGN_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict --verbose=4 "$APP_PATH"

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/postdoc-macos-dmg.XXXXXX")"
mount_dir=""
cleanup() {
  if [ -n "$mount_dir" ] && mount | grep -q " on $mount_dir "; then
    hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  fi
  if [ -n "$mount_dir" ]; then
    rmdir "$mount_dir" >/dev/null 2>&1 || true
  fi
  rm -rf "$stage_dir"
}
trap cleanup EXIT

ditto "$APP_PATH" "$stage_dir/$(basename "$APP_PATH")"
ln -s /Applications "$stage_dir/Applications"

echo "Recreating DMG: $DMG_PATH"
rm -f "$DMG_PATH"
hdiutil create \
  -volname "$(basename "$APP_PATH" .app)" \
  -srcfolder "$stage_dir" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$DMG_PATH"

mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/postdoc-macos-mount.XXXXXX")"
hdiutil attach "$DMG_PATH" -mountpoint "$mount_dir" -nobrowse -readonly >/dev/null
codesign --verify --deep --strict --verbose=4 "$mount_dir/$(basename "$APP_PATH")"
hdiutil detach "$mount_dir" >/dev/null
verified_mount_dir="$mount_dir"
mount_dir=""
rmdir "$verified_mount_dir" 2>/dev/null || true

echo "macOS release package is valid: $DMG_PATH"
