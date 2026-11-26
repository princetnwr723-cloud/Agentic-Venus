package com.agenticvenus.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** The bridge between the web app (JavaScript) and the computer on the phone. */
@CapacitorPlugin(name = "VenusLocal")
public class VenusLocalPlugin extends Plugin {

    private VenusLocalComputer pc() { return VenusLocalComputer.get(getContext()); }
    private VenusLocalRelay relay() { return VenusLocalRelay.get(getContext()); }

    @Override
    public void load() {
        pc().setListener(s -> {
            try { notifyListeners("state", new JSObject(s.toString())); } catch (Exception ignored) { }
        });
        relay().ensure(); // the app was opened and the computer is set up: go online
    }

    @Override
    protected void handleOnResume() { relay().setVisible(true); }

    @Override
    protected void handleOnPause() { relay().setVisible(false); }

    private void resolveStatus(PluginCall call) {
        try { call.resolve(new JSObject(pc().status().toString())); }
        catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    @PluginMethod
    public void status(PluginCall call) { resolveStatus(call); }

    /** Install the computer in the background. wifiOnly: wait for Wi-Fi when the phone is on mobile data. */
    @PluginMethod
    public void setup(PluginCall call) {
        boolean wifiOnly = Boolean.TRUE.equals(call.getBoolean("wifiOnly", false));
        pc().startSetup(wifiOnly);
        resolveStatus(call);
    }

    /**
     * Called by the app after sign-in, once per install: starts the setup by itself (on Wi-Fi only, so mobile data is not used up).
     * When the phone is on mobile data, it only shows the "Set up" card and waits for the person.
     */
    @PluginMethod
    public void autoSetup(PluginCall call) {
        VenusLocalComputer c = pc();
        if (c.unsupportedReason() == null && !c.installed() && !c.autoTried()) {
            if (c.startSetup(true)) c.markAutoTried();
        }
        resolveStatus(call);
    }

    @PluginMethod
    public void cancelSetup(PluginCall call) { pc().cancelSetup(); resolveStatus(call); }

    @PluginMethod
    public void start(final PluginCall call) {
        new Thread(() -> {
            try { pc().ensureRunning(); } catch (Exception e) { /* shown in status() */ }
            resolveStatus(call);
        }, "venus-computer-start").start();
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        new Thread(() -> { pc().stop(); resolveStatus(call); }, "venus-computer-stop").start();
    }

    @PluginMethod
    public void reset(final PluginCall call) {
        new Thread(() -> { pc().reset(); resolveStatus(call); }, "venus-computer-reset").start();
    }

    @PluginMethod
    public void setLimits(PluginCall call) {
        pc().setLimits(call.getInt("ramMB"), call.getInt("diskGB"));
        Integer idle = call.getInt("idleMinutes");
        if (idle != null) pc().setIdleMinutes(idle);
        resolveStatus(call);
    }

    /** "Use this phone's computer for my tasks" on or off. */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        pc().setEnabled(Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        relay().ensure();
        resolveStatus(call);
    }

    /** The computer key for the website ("venus-local:<id>"), or "" while the phone computer should not be used. */
    @PluginMethod
    public void localKey(final PluginCall call) {
        new Thread(() -> {
            JSObject o = new JSObject();
            String key = "";
            try {
                VenusLocalComputer c = pc();
                if (c.enabled() && c.installed() && VenusCore.configured(getContext())) {
                    String id = c.deviceId();
                    if (id == null) id = relay().register();
                    if (id != null) { key = "venus-local:" + id; relay().ensure(); }
                }
            } catch (Exception ignored) { }
            o.put("key", key);
            call.resolve(o);
        }, "venus-computer-key").start();
    }

    /** The website's task runner is active: stay online for another minute and a half. */
    @PluginMethod
    public void wake(PluginCall call) {
        relay().wake();
        call.resolve();
    }

    /** Sign-out: stop everything and forget this phone's id (the files of the computer stay). */
    @PluginMethod
    public void clear(final PluginCall call) {
        new Thread(() -> {
            try { pc().stop(); pc().setDeviceId(null); } catch (Exception ignored) { }
            call.resolve();
        }, "venus-computer-clear").start();
    }
}
