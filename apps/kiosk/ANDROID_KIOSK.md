# Shital Kiosk — Android Build

Wraps the existing kiosk SPA (`apps/kiosk`) as a locked-down Android app that
boots straight into donation flow and can't be exited. The card-reader logic
inside the SPA is untouched — Stripe Terminal JS SDK runs as-is inside the
WebView; WisePOS E continues to work over the internet exactly as on the web.

## One-time setup

```bash
# In apps/kiosk
bash scripts/setup-android-kiosk.sh
```

This generates `android/` via Capacitor, builds the SPA into `dist/`, then
overlays the kiosk-mode Java sources and patches `AndroidManifest.xml`. Safe
to re-run.

### Two build modes

| Mode | When to use | How |
|---|---|---|
| **Bundled** *(default)* | APK ships the SPA frozen — works briefly offline; UI updates require a new APK | `bash scripts/setup-android-kiosk.sh` |
| **Live** | Thin loader that pulls SPA from `https://shital.org.uk/kiosk/` — UI updates ship instantly with every deploy | `KIOSK_LIVE_URL=https://shital.org.uk/kiosk/ bash scripts/setup-android-kiosk.sh` |

Both modes still talk to the same backend over HTTPS for donations / device
auth / GiftAid.

## Build the APK

```bash
cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

For a signed release APK to side-load or upload to Play Console / MDM:

```bash
# First time: create a keystore
keytool -genkey -v -keystore kiosk.keystore -alias kiosk -keyalg RSA -keysize 2048 -validity 10000

# Add to apps/kiosk/android/keystore.properties:
#   storeFile=/abs/path/to/kiosk.keystore
#   storePassword=...
#   keyAlias=kiosk
#   keyPassword=...

cd android
./gradlew assembleRelease
```

## Provision a device as a true kiosk

A normal install is just a full-screen app — the user can swipe to exit. To
get **single-app lockdown** (HOME button does nothing, no notifications, no
settings, no escape) the app has to be **device owner**. This is irreversible
on that device without a factory reset.

```bash
# 1. Factory-reset the device
# 2. During Setup Wizard SKIP adding a Google account (critical — see script)
# 3. Enable Developer Options → USB Debugging
# 4. Connect by USB

bash scripts/provision-kiosk.sh
```

After reboot the device is a kiosk:
- Boots straight into the donation screen
- Power-on auto-launches the app (`KioskBootReceiver`)
- HOME, RECENTS, status pull-down all blocked
- Screen never sleeps
- Card reader (WisePOS E) pairs as normal — the SPA's existing flow

## Recovering a kiosk for service

Plug in USB and:

```bash
adb shell am force-stop org.shital.kiosk    # let you breathe
adb install -r android/app/build/outputs/apk/debug/app-debug.apk  # update
adb reboot
```

To fully un-kiosk the device, factory-reset it — there is no "downgrade"
from device-owner without that (Google's policy, not ours).

## What the kiosk uses

| Feature | How |
|---|---|
| Card reader | Stripe Terminal JS SDK → WisePOS E over the internet (unchanged from web) |
| NFC tag reads | Web NFC API in the WebView (if the device has NFC) |
| Camera (receipt scan) | `getUserMedia` from the SPA |
| Push from backend | Web Push + FCM via service worker (already in the SPA) |
| Screen-always-on | `FLAG_KEEP_SCREEN_ON` in `MainActivity` |
| Survive reboots | `KioskBootReceiver` + Lock Task Mode |

## Why Capacitor and not a TWA

A Trusted Web Activity can't enforce true single-app lockdown without device
owner — and to be device owner you need a Java/Kotlin shell, which is what
Capacitor gives you. We get all the SPA's existing payment / GiftAid / kiosk
flows for free, plus the Android lockdown we'd otherwise have to bolt onto
Chrome through MDM.

## Files in this directory

| Path | Purpose |
|---|---|
| `capacitor.config.ts` | Bundled vs live-URL mode; webDir / scheme |
| `android-kiosk-overlay/` | Java sources + manifest snippet copied into `android/` after Capacitor generates it |
| `scripts/setup-android-kiosk.sh` | One-shot bootstrap — runs `cap add android`, applies overlay |
| `scripts/patch-manifest.py` | Idempotent `AndroidManifest.xml` injector |
| `scripts/provision-kiosk.sh` | Turns a USB-connected device into a locked kiosk |
| `ANDROID_KIOSK.md` | This file |
| `android/` *(generated)* | Capacitor-generated Android project. Gitignored — regenerate any time. |
