package com.raft.focuslock;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import java.util.Set;

public class RaftAccessibilityService extends AccessibilityService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable scheduleChecker = new Runnable() {
        @Override
        public void run() {
            handler.postDelayed(this, 2000L);
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        handler.post(scheduleChecker);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        if (pkg.equals(getPackageName()) || pkg.equals("com.android.systemui")) return;

        if (!RaftLockState.isLockedNow(this)) return;

        long now = System.currentTimeMillis();
        if (now < RaftLockState.allowExternalAppLaunchUntilMs) return;
        if (pkg.equals(RaftLockState.lastLaunchedAllowedPackage)) return;

        Set<String> allowed = RaftLockState.getAllowedPackages(this);
        if (allowed.contains(pkg)) return;

        if (pkg.contains("inputmethod") || pkg.contains("keyboard") || pkg.contains("latin")) return;

        performGlobalAction(GLOBAL_ACTION_HOME);
        Intent lockIntent = new Intent(this, MainActivity.class);
        lockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(lockIntent);
        } catch (Exception ignored) {}
    }

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        handler.removeCallbacks(scheduleChecker);
        super.onDestroy();
    }
}
