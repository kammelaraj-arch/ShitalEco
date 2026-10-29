package org.shital.quickdonation;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Device-admin receiver — required to be set as device owner via
 * `adb shell dpm set-device-owner org.shital.quickdonation/.KioskDeviceAdminReceiver`
 * on a freshly-reset temple kiosk. Declared in the manifest with
 * BIND_DEVICE_ADMIN permission and references res/xml/device_admin.xml.
 *
 * We don't override policy callbacks because lock-down happens via Lock
 * Task Mode (started in MainActivity.onResume), not the heavier corp-MDM
 * policy surface.
 */
public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
    }
}
