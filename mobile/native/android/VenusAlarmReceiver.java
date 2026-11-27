package com.agenticvenus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * An exact alarm went off. Works with the app closed: it only needs one short network call, so no WebView.
 * Before that call it asks the phone computer's relay to stay online (when the owner set the computer up and left it on), so the routine
 * that the server starts can use THIS phone's computer, not only the cloud one.
 */
public class VenusAlarmReceiver extends BroadcastReceiver {
    private static final long HOLD_MS = 30 * 60_000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        final String action = intent.getAction();
        final String id = intent.getStringExtra("id");
        final String name = intent.getStringExtra("name");
        final long at = intent.getLongExtra("at", System.currentTimeMillis());
        final int attempt = intent.getIntExtra("attempt", 0);
        if (VenusCore.ACT_FIRE.equals(action)) {
            try { VenusLocalRelay.get(app).holdFor(HOLD_MS); } catch (Throwable ignored) { /* the routine itself must never fail because of this */ }
        }
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