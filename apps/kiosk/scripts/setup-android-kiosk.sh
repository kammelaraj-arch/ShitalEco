#!/usr/bin/env bash
# Bootstraps the Android Capacitor project for the Shital Kiosk and applies
# the kiosk-lockdown overlay.
#
# Run ONCE per fresh clone:
#   cd apps/kiosk
#   bash scripts/setup-android-kiosk.sh
#
# Idempotent — re-running is safe (will re-apply overlay over a regenerated
# android/ folder if you nuked it).
#
# Requirements:
#   • Android SDK installed (ANDROID_HOME / ANDROID_SDK_ROOT set)
#   • Java 17 (Capacitor 6 requires it; check with: java -version)
#   • npm install already run in apps/kiosk

set -euo pipefail
cd "$(dirname "$0")/.."

OVERLAY=android-kiosk-overlay
PKG_DIR=android/app/src/main/java/org/shital/kiosk
MANIFEST=android/app/src/main/AndroidManifest.xml
RES_XML=android/app/src/main/res/xml

if [[ ! -d node_modules ]]; then
    echo "▶ Installing npm deps..."
    npm install
fi

# 1) Build the SPA so dist/ exists for cap sync (or skip if you set KIOSK_LIVE_URL)
if [[ -z "${KIOSK_LIVE_URL:-}" ]]; then
    echo "▶ Building SPA into dist/ (set KIOSK_LIVE_URL to skip this step)..."
    npm run build:web
fi

# 2) Generate the Android project if not already present
if [[ ! -d android ]]; then
    echo "▶ Generating Android project via Capacitor..."
    npx cap add android
else
    echo "▶ android/ already exists — skipping cap add (re-syncing instead)"
fi

# 3) Sync the latest SPA + Capacitor config into android/
echo "▶ Syncing Capacitor..."
npx cap sync android

# 4) Apply the kiosk overlay — copy Java sources + res/xml into place
echo "▶ Applying kiosk overlay..."
mkdir -p "$PKG_DIR" "$RES_XML"
cp "$OVERLAY/MainActivity.java"              "$PKG_DIR/MainActivity.java"
cp "$OVERLAY/KioskDeviceAdminReceiver.java"  "$PKG_DIR/KioskDeviceAdminReceiver.java"
cp "$OVERLAY/KioskBootReceiver.java"         "$PKG_DIR/KioskBootReceiver.java"
cp "$OVERLAY/res/xml/device_admin.xml"       "$RES_XML/device_admin.xml"

# 5) Patch AndroidManifest.xml — guarded so re-runs don't duplicate elements.
#    Idempotency check: look for our boot-receiver class name.
if grep -q "KioskBootReceiver" "$MANIFEST"; then
    echo "▶ Manifest already patched — skipping"
else
    echo "▶ Patching AndroidManifest.xml..."
    python3 scripts/patch-manifest.py \
        --manifest "$MANIFEST" \
        --snippet  "$OVERLAY/AndroidManifest.kiosk-snippet.xml"
fi

echo ""
echo "✅ Setup complete."
echo ""
echo "Next steps:"
echo "  • Debug build:   cd android && ./gradlew assembleDebug"
echo "  • Release build: cd android && ./gradlew assembleRelease   (needs signing config)"
echo "  • Install on a USB-connected device:"
echo "       adb install -r android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "  • To turn that device into a true locked-down kiosk, see:"
echo "       scripts/provision-kiosk.sh   (run on a factory-reset device)"
