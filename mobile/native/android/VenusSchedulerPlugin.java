package com.agenticvenus.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** The bridge between the web app (JavaScript) and the phone's alarm clock. */
@CapacitorPlugin(name = "VenusScheduler")
public class VenusSchedulerPlugin extends Plugin {

    private Context ctx() { return getContext().getApplicationContext(); }

    @PluginMethod
    public void configure(PluginCall call) {
        final String appUrl = call.getString("appUrl", "");
        final String apiKey = call.getString("apiKey", "");
        final String rt = call.getString("refreshToken", "");
        if (appUrl.isEmpty() || apiKey.isEmpty() || rt.isEmpty()) { call.reject("appUrl, apiKey and refreshToken are required."); return; }
        VenusCore.configure(ctx(), appUrl, apiKey, rt);
        sync(call);
    }

    @PluginMethod
    public void sync(final PluginCall call) {
        new Thread(() -> {
            try {
                int armed = VenusCore.syncPlan(ctx());
                JSObject o = new JSObject();
                o.put("armed", armed);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }, "venus-sync").start();
    }

    @PluginMethod
    public void status(PluginCall call) {
        try {
            JSONObject s = VenusCore.status(ctx());
            call.resolve(new JSObject(s.toString()));
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void test(PluginCall call) {
        VenusCore.armTest(ctx(), call.getInt("seconds", 15));
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        VenusCore.clear(ctx());
        call.resolve();
    }

    @PluginMethod
    public void requestExactAlarm(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx().getPackageName())));
        }
        call.resolve();
    }

    @PluginMethod
    public void requestBatteryUnrestricted(PluginCall call) {
        try {
            open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx().getPackageName())));
        } catch (Exception e) {
            open(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx().getPackageName())));
        call.resolve();
    }

    /** Many phone makers hide a second "autostart / background" switch that kills alarms. Opens that page when we know where it is. */
    @PluginMethod
    public void openAutostart(PluginCall call) {
        String[][] pages = {
                {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
                {"com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity"},
                {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
                {"com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"},
                {"com.samsung.android.sm_cn", "com.samsung.android.sm.ui.battery.BatteryActivity"},
                {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
                {"com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"},
                {"com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"},
        };
        for (String[] pg : pages) {
            try {
                Intent i = new Intent().setComponent(new ComponentName(pg[0], pg[1])).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx().startActivity(i);
                JSObject o = new JSObject();
                o.put("opened", true);
                call.resolve(o);
                return;
            } catch (Exception ignored) { /* not this phone: try the next page */ }
        }
        open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx().getPackageName())));
        JSObject o = new JSObject();
        o.put("opened", false);
        call.resolve(o);
    }

    private void open(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx().startActivity(i);
        } catch (Exception ignored) { }
    }
}
