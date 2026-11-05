package com.raft.focuslock;

import android.app.Activity;
import android.app.NotificationManager;
import android.app.admin.DevicePolicyManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                if (url.startsWith("tel:") || url.startsWith("sms:") || url.startsWith("mailto:") || url.startsWith("https://wa.me")) {
                    try {
                        RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 8000L;
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        RaftLockState.isMainActivityInForeground = true;
        if (webView != null) {
            webView.evaluateJavascript("if(window.onAndroidResume) window.onAndroidResume();", null);
        }
    }

    @Override
    protected void onPause() {
        RaftLockState.isMainActivityInForeground = false;
        RaftLockState.lastMainActivityPausedMs = System.currentTimeMillis();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (RaftLockState.isLockedNow(this)) return;
        super.onBackPressed();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void copyToClipboard(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("LOCKIN", text));
        }

        @JavascriptInterface
        public String getInstalledApps() {
            JSONArray arr = new JSONArray();
            try {
                PackageManager pm = getPackageManager();
                Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
                mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> list = pm.queryIntentActivities(mainIntent, 0);
                for (ResolveInfo ri : list) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(getPackageName())) continue;
                    String label = ri.loadLabel(pm).toString();
                    JSONObject obj = new JSONObject();
                    obj.put("id", "pkg-" + pkg);
                    obj.put("name", label);
                    obj.put("packageName", pkg);
                    arr.put(obj);
                }
            } catch (Exception ignored) {}
            return arr.toString();
        }

        @JavascriptInterface
        public boolean launchApp(String packageName) {
            try {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage(packageName);
                if (launchIntent != null) {
                    RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 15000L;
                    RaftLockState.lastLaunchedAllowedPackage = packageName;
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launchIntent);
                    return true;
                }
            } catch (Exception ignored) {}
            return false;
        }

        @JavascriptInterface
        public void dialPhone(String phone) {
            try {
                RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 10000L;
                Intent i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void sendSms(String phone) {
            try {
                RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 10000L;
                Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + phone));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void setFocusLockState(boolean locked, String allowedCsv, String label) {
            RaftLockState.setLockState(MainActivity.this, locked, allowedCsv, label);
        }

        @JavascriptInterface
        public void syncScheduleAndLockConfigStr(
            String blocksJson,
            String allowedCsv,
            String overriddenId,
            String manualEndMsStr,
            String unlockEndMsStr
        ) {
            long m = 0L, u = 0L;
            try { m = Long.parseLong(manualEndMsStr); } catch (Exception ignored) {}
            try { u = Long.parseLong(unlockEndMsStr); } catch (Exception ignored) {}
            RaftLockState.syncFullSchedule(MainActivity.this, blocksJson, allowedCsv, overriddenId, m, u);
        }

        @JavascriptInterface
        public void startEmergencyBreak(int durationSec, String allowedCsv) {
            long until = System.currentTimeMillis() + (durationSec * 1000L);
            RaftLockState.setTemporaryUnlockUntil(MainActivity.this, until, allowedCsv);
        }

        @JavascriptInterface
        public void startGuardianUnlock(int durationSec, String allowedCsv) {
            long until = System.currentTimeMillis() + (durationSec * 1000L);
            RaftLockState.setTemporaryUnlockUntil(MainActivity.this, until, allowedCsv);
        }

        @JavascriptInterface
        public void cancelEmergencyBreak() {
            RaftLockState.setTemporaryUnlockUntil(MainActivity.this, 0L, null);
        }

        @JavascriptInterface
        public boolean isAccessibilityServiceEnabled() {
            String pref = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return pref != null && pref.contains(getPackageName() + "/" + RaftAccessibilityService.class.getName());
        }

        @JavascriptInterface
        public boolean isAccessibilityGranted() { return isAccessibilityServiceEnabled(); }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 30000L;
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        }

        @JavascriptInterface
        public void requestAccessibilityPermission() { openAccessibilitySettings(); }

        @JavascriptInterface
        public boolean isOverlayPermissionGranted() {
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(MainActivity.this);
        }

        @JavascriptInterface
        public boolean isOverlayGranted() { return isOverlayPermissionGranted(); }

        @JavascriptInterface
        public void openOverlaySettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 30000L;
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
            }
        }

        @JavascriptInterface
        public void requestOverlayPermission() { openOverlaySettings(); }

        @JavascriptInterface
        public boolean isDeviceAdminEnabled() {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName cn = new ComponentName(MainActivity.this, RaftDeviceAdminReceiver.class);
            return dpm != null && dpm.isAdminActive(cn);
        }

        @JavascriptInterface
        public boolean isAdminActive() { return isDeviceAdminEnabled(); }

        @JavascriptInterface
        public boolean isAdminGranted() { return isDeviceAdminEnabled(); }

        @JavascriptInterface
        public void openDeviceAdminSettings() {
            RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 30000L;
            ComponentName cn = new ComponentName(MainActivity.this, RaftDeviceAdminReceiver.class);
            Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, cn);
            startActivity(intent);
        }

        @JavascriptInterface
        public void requestDeviceAdmin() { openDeviceAdminSettings(); }

        @JavascriptInterface
        public void requestAdminPermission() { openDeviceAdminSettings(); }

        @JavascriptInterface
        public boolean isDndPermissionGranted() {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (nm != null && nm.isNotificationPolicyAccessGranted());
        }

        @JavascriptInterface
        public boolean isDndGranted() { return isDndPermissionGranted(); }

        @JavascriptInterface
        public void openDndSettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 30000L;
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
            }
        }

        @JavascriptInterface
        public void requestDndPermission() { openDndSettings(); }

        @JavascriptInterface
        public boolean isBatteryOptimizationIgnored() {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName()));
        }

        @JavascriptInterface
        public boolean isBatteryGranted() { return isBatteryOptimizationIgnored(); }

        @JavascriptInterface
        public void openBatterySettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                RaftLockState.allowExternalAppLaunchUntilMs = System.currentTimeMillis() + 30000L;
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                startActivity(i);
            }
        }

        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() { openBatterySettings(); }

        @JavascriptInterface
        public void requestBatteryOptimization() { openBatterySettings(); }
    }
}
