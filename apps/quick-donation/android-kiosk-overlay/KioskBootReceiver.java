package org.shital.quickdonation;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Auto-launches the Quick Donation app after device boot. Critical for the
 * unattended on-site kiosk — without this, after a power cycle the device
 * sits on the launcher and staff have to physically interact to re-open the
 * donation screen.
 *
 * On a devotee's phone this still fires on boot; combined with the
 * fullscreen MainActivity it means the app re-opens itself after reboot.
 * That's expected for a kiosk APK; a devotee who doesn't want it can
 * uninstall or disable auto-start in system settings.
 */
public class KioskBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                          | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
        }
    }
}
