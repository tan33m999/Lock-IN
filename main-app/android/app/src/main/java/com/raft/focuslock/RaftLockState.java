package com.raft.focuslock;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class RaftLockState {
    private static final String PREF_NAME = "raft_native_prod_v1";
    public static volatile boolean isMainActivityInForeground = false;
    public static volatile long lastMainActivityPausedMs = 0L;
    public static volatile long allowExternalAppLaunchUntilMs = 0L;
    public static volatile String lastLaunchedAllowedPackage = "";

    private static SharedPreferences getPrefs(Context context) {
        Context storageCtx = context.createDeviceProtectedStorageContext();
        return storageCtx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    public static void setLockState(Context context, boolean locked, String allowedCsv, String label) {
        getPrefs(context).edit()
            .putBoolean("is_locked", locked)
            .putString("allowed_csv", allowedCsv != null ? allowedCsv : "")
            .putString("block_label", label != null ? label : "Focus Lock")
            .apply();
    }

    public static void syncFullSchedule(
        Context context,
        String blocksJson,
        String allowedCsv,
        String overriddenId,
        long manualEndMs,
        long unlockEndMs
    ) {
        getPrefs(context).edit()
            .putString("blocks_json", blocksJson != null ? blocksJson : "[]")
            .putString("allowed_csv", allowedCsv != null ? allowedCsv : "")
            .putString("overridden_id", overriddenId != null ? overriddenId : "")
            .putLong("manual_end_ms", manualEndMs)
            .putLong("unlock_end_ms", unlockEndMs)
            .apply();
    }

    public static void setTemporaryUnlockUntil(Context context, long untilMs, String allowedCsv) {
        SharedPreferences.Editor ed = getPrefs(context).edit().putLong("unlock_end_ms", untilMs);
        if (allowedCsv != null && !allowedCsv.isEmpty()) {
            ed.putString("allowed_csv", allowedCsv);
        }
        ed.apply();
    }

    public static boolean isTemporarilyUnlocked(Context context) {
        long until = getPrefs(context).getLong("unlock_end_ms", 0L);
        return until > System.currentTimeMillis();
    }

    public static boolean isLockedNow(Context context) {
        if (isTemporarilyUnlocked(context)) return false;
        SharedPreferences prefs = getPrefs(context);
        long nowMs = System.currentTimeMillis();
        long manualEnd = prefs.getLong("manual_end_ms", 0L);
        if (manualEnd > nowMs) return true;
        if (isScheduledBlockRunningNow(context)) return true;
        return prefs.getBoolean("is_locked", false);
    }

    public static boolean isScheduledBlockRunningNow(Context context) {
        SharedPreferences prefs = getPrefs(context);
        String json = prefs.getString("blocks_json", "[]");
        String overridden = prefs.getString("overridden_id", "");
        try {
            JSONArray arr = new JSONArray(json);
            Calendar cal = Calendar.getInstance();
            int nowSec = cal.get(Calendar.HOUR_OF_DAY) * 3600 + cal.get(Calendar.MINUTE) * 60 + cal.get(Calendar.SECOND);
            String[] dayKeys = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
            int dow = cal.get(Calendar.DAY_OF_WEEK) - 1;
            String todayKey = dayKeys[dow];
            String yesterdayKey = dayKeys[(dow + 6) % 7];

            for (int i = 0; i < arr.length(); i++) {
                JSONObject b = arr.getJSONObject(i);
                if (!b.optBoolean("enabled", false)) continue;
                String id = b.optString("id", "");
                if (!id.isEmpty() && id.equals(overridden)) continue;

                String[] sp = b.optString("startTime", "00:00").split(":");
                String[] ep = b.optString("endTime", "00:00").split(":");
                int startSec = Integer.parseInt(sp[0]) * 3600 + Integer.parseInt(sp[1]) * 60;
                int endSec = Integer.parseInt(ep[0]) * 3600 + Integer.parseInt(ep[1]) * 60;

                JSONArray daysArr = b.optJSONArray("days");
                Set<String> activeDays = new HashSet<>();
                if (daysArr != null && daysArr.length() > 0) {
                    for (int d = 0; d < daysArr.length(); d++) activeDays.add(daysArr.getString(d));
                } else {
                    for (String k : dayKeys) activeDays.add(k);
                }

                if (startSec < endSec) {
                    if (activeDays.contains(todayKey) && nowSec >= startSec && nowSec < endSec) return true;
                } else if (startSec > endSec) {
                    if (activeDays.contains(todayKey) && nowSec >= startSec) return true;
                    if (activeDays.contains(yesterdayKey) && nowSec < endSec) return true;
                } else if (activeDays.contains(todayKey)) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    public static Set<String> getAllowedPackages(Context context) {
        Set<String> set = new HashSet<>();
        set.add(context.getPackageName());
        set.add("com.raft.guardian");
        set.add("com.android.systemui");
        set.add("com.android.incallui");
        set.add("com.google.android.dialer");
        set.add("com.samsung.android.incallui");
        set.add("com.samsung.android.dialer");

        String csv = getPrefs(context).getString("allowed_csv", "");
        if (csv != null && !csv.isEmpty()) {
            for (String p : csv.split(",")) {
                String trimmed = p.trim();
                if (!trimmed.isEmpty()) set.add(trimmed);
            }
        }
        return set;
    }
}
