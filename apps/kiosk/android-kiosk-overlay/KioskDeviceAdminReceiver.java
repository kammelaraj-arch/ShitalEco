package org.shital.kiosk;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Device-admin receiver — required for the app to be set as device owner via
 * `adb shell dpm set-device-owner`. The class must exist, be declared in the
 * manifest with BIND_DEVICE_ADMIN permission, and reference res/xml/device_admin.xml.
 *
 * We don't override any policy callbacks because we don't actively enforce
 * password complexity / wipe-on-fail / etc. — the kiosk is locked down via
 * Lock Task Mode, not via the heavier corp-MDM policy surface.
 */
public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
        // No-op. Lock Task Mode enforcement happens in MainActivity.onResume().
    }
}
