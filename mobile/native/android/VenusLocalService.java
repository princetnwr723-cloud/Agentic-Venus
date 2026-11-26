package com.agenticvenus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * A steady notification while the phone computer runs: it keeps Android from closing the app in the middle of a task, shows what is
 * happening, and has a "Stop" button that ends the computer and gives the RAM back at once. It exists only while the computer runs.
 */
public class VenusLocalService extends Service {
    static final String CH = "venus_computer";
    static final int ID = 4102;
    static final String ACT_STOP = "com.agenticvenus.app.COMPUTER_STOP";
    static final String EXTRA_TEXT = "text";

    /** Starts (on) or ends (off) the notification. Never throws: Android 12+ may refuse to start a service while the app is in the background. */
    static void sync(Context ctx, boolean on, String text) {
        try {
            Intent i = new Intent(ctx, VenusLocalService.class).putExtra(EXTRA_TEXT, text == null ? "" : text);
            if (on) ContextCompat.startForegroundService(ctx, i); else ctx.stopService(i);
        } catch (Exception ignored) { /* the computer still runs; it is just not shown */ }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACT_STOP.equals(intent.getAction())) {
            VenusLocalComputer.get(this).stop();
            stopSelf();
            return START_NOT_STICKY;
        }
        String text = intent == null ? "" : intent.getStringExtra(EXTRA_TEXT);
        VenusLocalComputer pc = VenusLocalComputer.get(this);
        String body = (text == null || text.isEmpty() ? "Computer chal raha hai" : text) + " · RAM limit " + VenusLocalLogic.mb(pc.ramLimitMB());
        Notification n = build(body);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
        } catch (Exception e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification build(String body) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            nm.createNotificationChannel(new NotificationChannel(CH, "Phone computer", NotificationManager.IMPORTANCE_LOW));
        }
        int icon = getResources().getIdentifier("ic_stat_venus", "drawable", getPackageName());
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = launch == null ? null : PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, VenusLocalService.class).setAction(ACT_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CH)
                .setSmallIcon(icon != 0 ? icon : android.R.drawable.ic_popup_reminder)
                .setContentTitle("Venus computer")
                .setContentText(body)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(tap)
                .addAction(0, "Band karo", stop)
                .build();
    }

    /** Android 14/15 end a "data sync" service after a long time: give the RAM back instead of being killed in the middle. */
    public void onTimeout(int startId) { endNow(); }

    public void onTimeout(int startId, int fgsType) { endNow(); }

    private void endNow() {
        try { VenusLocalComputer.get(this).stop(); } catch (Exception ignored) { }
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
