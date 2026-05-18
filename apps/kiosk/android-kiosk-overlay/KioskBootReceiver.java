package org.shital.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Auto-launches the kiosk after device boot. Critical for unattended temple
 * installs where the device might lose power overnight — without this, after
 * reboot the device sits on the launcher (or wherever Lock Task left it) and
 * staff have to physically interact with it.
 *
 * Registered against BOOT_COMPLETED + LOCKED_BOOT_COMPLETED so we launch as
 * early as possible (before the user unlocks, when the device is set as
 * device owner there is no lock screen anyway).
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
