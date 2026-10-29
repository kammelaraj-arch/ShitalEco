#!/usr/bin/env bash
# Provisions a USB-connected Android tablet as a locked-down Shital Quick
# Donation kiosk. One-time setup — after this the device will come up on
# the donation screen on every boot and the HOME / BACK / OVERVIEW buttons
# will do nothing until the admin exits via ADB.
#
# CRITICAL PRE-REQS — do these in order on the *physical* tablet first:
#   1. Factory reset (Settings → System → Reset → Erase all data).
#   2. During Setup Wizard: SKIP adding any Google account. With even one
#      Google account on the device, `dpm set-device-owner` will refuse
#      — this is a one-shot operation that has to happen before the device
#      is "personalised".
#   3. Enable Developer Options → USB Debugging.
#   4. Connect via USB and accept the debugging prompt on the device.
#
# Then on your laptop:
#   bash apps/quick-donation/scripts/provision-kiosk.sh
#
# Or point APK= at a specific build:
#   APK=~/Downloads/shital-quick-donation-latest.apk bash provision-kiosk.sh
#
# After this runs, the tablet reboots and comes up locked into the Quick
# Donation kiosk — no system bars, no clickable HOME / BACK, no exit.

set -euo pipefail
cd "$(dirname "$0")/.."

APK=${APK:-android/app/build/outputs/apk/debug/app-debug.apk}
PKG=org.shital.quickdonation
ADMIN_CLASS=org.shital.quickdonation/.KioskDeviceAdminReceiver

# Pre-flight ----------------------------------------------------------------
if ! command -v adb &>/dev/null; then
    echo "❌ adb not found in PATH — install Android platform-tools first."
    exit 1
fi
if [[ ! -f "$APK" ]]; then
    echo "❌ APK not found at $APK"
    echo "   Download from the admin Downloads page or build locally."
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
echo "▶ Disabling status bar, screensaver, timeout..."
adb -s "$DEV" shell settings put global policy_control immersive.full=* || true
adb -s "$DEV" shell settings put secure lockscreen.disabled 1 || true
adb -s "$DEV" shell settings put system screen_off_timeout 2147483647 || true
adb -s "$DEV" shell settings put secure user_setup_complete 1 || true

# 4) Make Quick Donation the home launcher so HOME button does nothing ---
echo "▶ Setting Quick Donation as the home launcher..."
adb -s "$DEV" shell cmd package set-home-activity \
    "$PKG/org.shital.quickdonation.MainActivity" || true

# 5) Reboot — kiosk auto-launches via the boot receiver
echo "▶ Rebooting device..."
adb -s "$DEV" reboot

echo ""
echo "✅ Provisioning complete."
echo ""
echo "After reboot the kiosk comes up on the donation screen and the"
echo "HOME / BACK / OVERVIEW buttons do nothing."
echo ""
echo "To temporarily exit for service:"
echo "  adb shell am force-stop $PKG"
echo "  adb shell pm clear-pinning-restrictions   # Android 9+"
echo ""
echo "To un-provision (returns to normal Android):"
echo "  adb shell dpm remove-active-admin $ADMIN_CLASS"
echo "  …or factory-reset."
