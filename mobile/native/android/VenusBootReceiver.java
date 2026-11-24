package com.agenticvenus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot, an app update, a clock change, a time-zone change or a new exact-alarm permission, every alarm is gone or wrong: arm them again. */
public class VenusBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                VenusCore.syncPlan(app);
            } catch (Throwable ignored) {
            } finally {
                pending.finish();
            }
        }, "venus-boot").start();
    }
}
