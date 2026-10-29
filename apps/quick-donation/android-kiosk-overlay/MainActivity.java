package org.shital.quickdonation;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Shital Quick Donation — Android entry point.
 *
 *  1. Keep the screen on permanently so a temple kiosk doesn't sleep.
 *  2. Hide system bars via immersive sticky mode so the full-screen
 *     donation chrome fills the display edge-to-edge; swipes briefly
 *     peek the bars (fine on a devotee's own phone) and auto-hide.
 *  3. Lay out through display cutouts.
 *  4. On a device where this APK is set as device owner (`adb shell
 *     dpm set-device-owner org.shital.quickdonation/.KioskDeviceAdminReceiver`
 *     on a freshly-reset device), enter Lock Task Mode — a true
 *     single-app kiosk that can't be escaped with Back + Overview.
 *     On a devotee's phone the device-owner call is a no-op (silently
 *     caught) so this does nothing invasive.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersive();

        try {
            DevicePolicyManager dpm = (DevicePolicyManager)
                getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin =
                new ComponentName(this, KioskDeviceAdminReceiver.class);
            if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
                dpm.setLockTaskPackages(admin, new String[] { getPackageName() });

                ActivityManager am = (ActivityManager)
                    getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null && am.getLockTaskModeState()
                        == ActivityManager.LOCK_TASK_MODE_NONE) {
                    startLockTask();
                }
            }
        } catch (Exception ignored) {
            // Non-fatal: not device-owner (phone install) or older OS.
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) onResume();
    }

    private void applyImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }
}
