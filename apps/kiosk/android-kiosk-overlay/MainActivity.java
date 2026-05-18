package org.shital.kiosk;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Shital Kiosk — Android entry point.
 *
 * Adds three kiosk-specific behaviors on top of Capacitor's BridgeActivity:
 *
 *  1. Keep the screen on permanently while the app is foregrounded. Without
 *     this the screen sleeps after the device's normal idle timeout and the
 *     temple kiosk stops accepting donations until someone taps it.
 *
 *  2. Hide the system bars (status + nav) via immersive sticky mode so a
 *     curious user can't swipe up to escape into the launcher.
 *
 *  3. Enter Lock Task Mode if the app is the device owner. This is the only
 *     reliable way on stock Android to enforce a "single-app kiosk" — screen
 *     pinning can be cancelled with hold-back+overview; lock task mode while
 *     device-owner cannot. Provision via:
 *         adb shell dpm set-device-owner org.shital.kiosk/.KioskDeviceAdminReceiver
 *     on a freshly-factory-reset device with NO Google account added yet.
 *
 * If the app is NOT device owner (e.g. dev install), lock task is skipped and
 * the kiosk behaves like a normal full-screen Capacitor app — exitable, useful
 * for development.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1) Screen always on — overrides system sleep timer
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Allow display through hardware-cutouts so the kiosk fills cheap
        // tablets with notches without leaving a black bar.
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

        // 2) Immersive sticky — system bars hidden but can briefly peek when
        //    the user swipes from the edge, then auto-hide again. Survives
        //    dialog dismissals which plain SYSTEM_UI_FLAG_FULLSCREEN does not.
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );

        // 3) Lock Task Mode — only succeeds if we're device owner. Wrap in
        //    try/catch so a non-provisioned dev install doesn't crash.
        try {
            DevicePolicyManager dpm = (DevicePolicyManager)
                getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(this, KioskDeviceAdminReceiver.class);
            if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
                // Whitelist ourselves so startLockTask() succeeds without the
                // "Screen pinned" dialog that requires user tap-confirm.
                dpm.setLockTaskPackages(admin, new String[] { getPackageName() });

                ActivityManager am = (ActivityManager)
                    getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null && am.getLockTaskModeState()
                        == ActivityManager.LOCK_TASK_MODE_NONE) {
                    startLockTask();
                }
            }
        } catch (Exception ignored) {
            // Non-fatal: dev install or older OS — fall through to normal app.
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-apply immersive flags after any focus change (dialogs, notifs).
        if (hasFocus) {
            onResume();
        }
    }
}
