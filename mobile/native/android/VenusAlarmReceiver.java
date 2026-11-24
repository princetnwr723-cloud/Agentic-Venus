package com.agenticvenus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** An exact alarm went off. Works with the app closed: it only needs one short network call, so no WebView and no service. */
public class VenusAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        final String action = intent.getAction();
        final String id = intent.getStringExtra("id");
        final String name = intent.getStringExtra("name");
        final long at = intent.getLongExtra("at", System.currentTimeMillis());
        final int attempt = intent.getIntExtra("attempt", 0);
        new Thread(() -> {
            try {
                VenusCore.handle(app, action, id, at, name == null ? "Routine" : name, attempt);
            } catch (Throwable ignored) {
            } finally {
                pending.finish();
            }
        }, "venus-alarm").start();
    }
}
