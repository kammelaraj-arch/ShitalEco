package org.shital.quickdonation;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Shital Quick Donation — Android entry point.
 *
 * Full-screen kiosk-style wrapper around the Capacitor BridgeActivity:
 *
 *  1. Keep the screen on permanently while the app is foregrounded so a
 *     temple kiosk running this APK never dims and stops accepting
 *     donations.
 *  2. Hide the system bars (status + nav) via immersive sticky mode so
 *     the donation chrome fills the screen edge-to-edge. Swiping from
 *     an edge briefly peeks the bars (which is enough on a devotee's
 *     own phone) and they auto-hide again.
 *  3. Lay out through hardware cutouts so cheap tablets with notches
 *     don't leave a black bar at the top.
 *
 * Unlike the main Kiosk app we do NOT enter Lock Task Mode here — the
 * Quick Donation APK is distributed both to on-site kiosks AND to
 * devotees' personal phones (per the Software Downloads page), so
 * device-owner locking would be hostile for the latter.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Screen always on — overrides the system idle timer.
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
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
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
