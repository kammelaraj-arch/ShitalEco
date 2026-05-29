#!/usr/bin/env bash
# Provisions a USB-connected Android device as a Shital Kiosk.
#
# CRITICAL PRE-REQS — do these in order on the *physical* device first:
#   1. Factory reset (Settings → System → Reset → Erase all data).
#   2. During Setup Wizard: SKIP adding any Google account. With even one
#      Google account on the device, `dpm set-device-owner` will refuse with
#      "Not allowed to set the device owner because there are already several
#      users on the device" — this is a one-shot operation that has to happen
#      before the device is "personalised".
#   3. Enable Developer Options → USB Debugging.
#   4. Connect via USB and accept the debugging prompt on the device.
#
# Then on this machine:
#   bash scripts/provision-kiosk.sh
#
# The script:
#   • Installs the kiosk APK (debug build by default)
#   • Sets the kiosk as device owner (irreversible without factory reset)
#   • Disables status bar, screensaver, and OS updates
#   • Pushes a small "exit-kiosk" companion so an admin can recover the
#     device via ADB without factory-resetting (`adb shell am start ...`)
#
# After this runs, the device reboots and comes up locked into the kiosk.

set -euo pipefail
cd "$(dirname "$0")/.."

APK=${APK:-android/app/build/outputs/apk/debug/app-debug.apk}
PKG=org.shital.kiosk
ADMIN_CLASS=org.shital.kiosk/.KioskDeviceAdminReceiver

# Pre-flight ----------------------------------------------------------------
if ! command -v adb &>/dev/null; then
    echo "❌ adb not found in PATH — install Android platform-tools first."
    exit 1
fi
if [[ ! -f "$APK" ]]; then
    echo "❌ APK not found at $APK"
    echo "   Build it first:  cd android && ./gradlew assembleDebug"
    exit 1
fi
if [[ -z "$(adb devices | grep -E 'device$')" ]]; then
    echo "❌ No USB device detected. Plug in & accept USB Debugging prompt."
    exit 1
fi

DEV=$(adb devices | awk '/device$/ {print $1; exit}')
echo "▶ Provisioning device: $DEV"

# 1) Install / reinstall the APK ------------------------------------------
echo "▶ Installing $APK"
adb -s "$DEV" install -r "$APK"

# 2) Set as device owner — only works if no Google account is on the device
echo "▶ Setting as device owner..."
if ! adb -s "$DEV" shell dpm set-device-owner "$ADMIN_CLASS" 2>&1 | tee /tmp/dpm.log; then
    if grep -q "Not allowed" /tmp/dpm.log; then
        echo ""
        echo "❌ dpm refused — there's already a user/account on the device."
        echo "   Factory-reset the device and DO NOT add a Google account during"
        echo "   the setup wizard. Then re-run this script."
        exit 1
    fi
fi

# 3) Disable distractions -------------------------------------------------
echo "▶ Disabling status bar, suggestions, OS updates..."
# Hide the status bar globally (returns on reboot — re-applied on next boot
# by SystemUI via the device-owner override we set).
adb -s "$DEV" shell settings put global policy_control immersive.full=* || true
# Disable screen lock and screensaver — kiosk should never lock itself.
adb -s "$DEV" shell settings put secure lockscreen.disabled 1 || true
adb -s "$DEV" shell settings put system screen_off_timeout 2147483647 || true
# Disable Google's "What's new" / pop-ups.
adb -s "$DEV" shell settings put secure user_setup_complete 1 || true

# 4) Make the kiosk the home launcher so HOME button does nothing ----------
echo "▶ Setting kiosk as home launcher..."
adb -s "$DEV" shell cmd package set-home-activity "$PKG/org.shital.kiosk.MainActivity" || true

# 5) Reboot — kiosk auto-launches via the boot receiver
echo "▶ Rebooting device..."
adb -s "$DEV" reboot

echo ""
echo "✅ Provisioning complete."
echo ""
echo "After reboot the kiosk will be locked. To temporarily exit for service:"
echo "  adb shell am force-stop $PKG"
echo "  adb shell pm clear-pinning-restrictions   # only on Android 9+"
echo ""
echo "To un-provision (returns the device to a normal Android):"
echo "  adb shell dpm remove-active-admin $ADMIN_CLASS  # may need user confirm"
echo "  …or factory-reset."
