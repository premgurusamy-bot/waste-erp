package com.greencycle.erp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

/** First-run setup (which office server to use) and the in-app settings screen, including uninstall. */
public class SetupActivity extends Activity {
    static final String EXTRA_SETTINGS = "settings";
    static final String GREEN = "#039855";

    EditText address;
    TextView status;
    Button connect;
    Button saveAnyway;
    final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor(MainActivity.NAVY));
        getWindow().setNavigationBarColor(Color.parseColor("#f1f5f9"));
        boolean settings = getIntent().getBooleanExtra(EXTRA_SETTINGS, false);
        SharedPreferences prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#f1f5f9"));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setBackgroundColor(Color.parseColor(MainActivity.NAVY));
        header.setPadding(dp(24), dp(36), dp(24), dp(28));
        TextView brand = text("GREENCYCLE ERP", 13, "#32d583", true);
        brand.setLetterSpacing(0.12f);
        header.addView(brand);
        TextView title = text(settings ? "App settings" : "Welcome", 26, "#ffffff", true);
        title.setPadding(0, dp(8), 0, 0);
        header.addView(title);
        header.addView(text(settings ? "Server address, refresh and uninstall." : "Connect this phone to your office GreenCycle server.", 15, "#c7d3e6", false));
        page.addView(header);

        LinearLayout card = card();
        card.addView(text("Server address", 14, "#0f172a", true));
        address = new EditText(this);
        address.setHint("e.g. erp.yourcompany.in or 192.168.1.20:3000");
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        String current = prefs.getString(MainActivity.KEY_SERVER, null);
        if (current != null) address.setText(current.replaceFirst("^https?://", ""));
        card.addView(address);
        card.addView(text("Ask your administrator. It is shown in GreenCycle on the office computer under Settings → Mobile App.", 13, "#64748b", false));
        status = text("", 14, "#b42318", false);
        status.setVisibility(View.GONE);
        status.setPadding(0, dp(10), 0, 0);
        card.addView(status);
        connect = button(settings ? "Save and connect" : "Connect", GREEN, "#ffffff");
        connect.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { test(); }
        });
        card.addView(connect);
        saveAnyway = button("Use this address anyway", "#e2e8f0", "#0f172a");
        saveAnyway.setVisibility(View.GONE);
        saveAnyway.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { save(normalise(address.getText().toString())); }
        });
        card.addView(saveAnyway);
        page.addView(card);

        if (settings) {
            LinearLayout more = card();
            Button reload = button("Reload app", "#e2e8f0", "#0f172a");
            reload.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) { setResult(MainActivity.RESULT_RELOAD); finish(); }
            });
            more.addView(reload);
            Button signOut = button("Clear data and sign out", "#e2e8f0", "#0f172a");
            signOut.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    CookieManager.getInstance().removeAllCookies(null);
                    CookieManager.getInstance().flush();
                    WebStorage.getInstance().deleteAllData();
                    setResult(MainActivity.RESULT_RELOAD);
                    finish();
                }
            });
            more.addView(signOut);
            Button uninstall = button("Uninstall app", "#fee4e2", "#b42318");
            uninstall.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) { confirmUninstall(); }
            });
            more.addView(uninstall);
            TextView ver = text("GreenCycle ERP for Android · version 1.1", 12, "#94a3b8", false);
            ver.setGravity(Gravity.CENTER);
            ver.setPadding(0, dp(14), 0, 0);
            more.addView(ver);
            page.addView(more);
        }

        address.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            public boolean onEditorAction(TextView v, int id, android.view.KeyEvent e) { test(); return true; }
        });

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(page);
        setContentView(scroll);
    }

    /** "192.168.1.20" -> "http://192.168.1.20:3000"; keeps https and explicit ports as typed. */
    static String normalise(String raw) {
        String s = raw.trim().replaceAll("\\s+", "");
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (s.isEmpty()) return "";
        if (!s.matches("(?i)^https?://.*")) {
            // Office addresses (192.168.x.x, localhost) are plain http on port 3000; internet names use https.
            String h = s.split("[:/]")[0];
            boolean local = h.matches("^[0-9.]+$") || h.equalsIgnoreCase("localhost") || !h.contains(".");
            s = (local ? "http://" : "https://") + s;
        }
        String host = s.replaceFirst("(?i)^https?://", "");
        if (s.toLowerCase().startsWith("http://") && !host.contains(":") && !host.contains("/")) s = s + ":3000";
        return s;
    }

    void test() {
        final String url = normalise(address.getText().toString());
        if (url.isEmpty()) {
            show("Enter the server address first.", false);
            return;
        }
        connect.setEnabled(false);
        connect.setText("Checking…");
        new Thread(new Runnable() {
            public void run() {
                String error = null;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url + "/api/health").openConnection();
                    c.setConnectTimeout(6000);
                    c.setReadTimeout(6000);
                    String body = new Scanner(c.getInputStream()).useDelimiter("\\A").next();
                    if (!body.contains("\"database\"")) error = "That address answered, but it is not a GreenCycle server.";
                    else if (!body.contains("\"ok\"")) error = "The server is running but its database is not. Check the office computer.";
                } catch (Exception e) {
                    error = "Cannot reach " + url + ". Check the phone has internet (or office Wi-Fi for 192.168 addresses) and the office computer is running GreenCycle.";
                }
                final String err = error;
                ui.post(new Runnable() {
                    public void run() {
                        connect.setEnabled(true);
                        connect.setText("Connect");
                        if (err == null) save(url);
                        else show(err, true);
                    }
                });
            }
        }).start();
    }

    void save(String url) {
        if (url.isEmpty()) return;
        getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).edit().putString(MainActivity.KEY_SERVER, url).apply();
        setResult(RESULT_OK);
        finish();
    }

    void show(String msg, boolean offerSave) {
        status.setText(msg);
        status.setVisibility(View.VISIBLE);
        saveAnyway.setVisibility(offerSave ? View.VISIBLE : View.GONE);
    }

    void confirmUninstall() {
        new AlertDialog.Builder(this)
                .setTitle("Uninstall GreenCycle ERP?")
                .setMessage("The app is removed from this phone. Your company data stays safe on the office server.")
                .setPositiveButton("Uninstall", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface d, int w) {
                        startActivity(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + getPackageName())));
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    // ---------- small view helpers ----------

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    TextView text(String s, int sp, String color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor(color));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(20), dp(18), dp(20), dp(20));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(16));
        c.setBackground(bg);
        c.setElevation(dp(2));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(16), dp(16), dp(16), 0);
        c.setLayoutParams(lp);
        return c;
    }

    Button button(String label, String bgColor, String fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(Color.parseColor(fg));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(bgColor));
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        b.setStateListAnimator(null);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }
}
