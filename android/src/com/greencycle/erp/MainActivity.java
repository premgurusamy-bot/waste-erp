package com.greencycle.erp;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * GreenCycle ERP for Android: a full-screen window onto the GreenCycle server in the office,
 * plus the phone features the web app needs (camera, GPS, downloads, printing).
 */
public class MainActivity extends Activity {
    static final String PREFS = "greencycle";
    static final String KEY_SERVER = "server";
    static final int REQ_SETUP = 1, REQ_FILE = 2, REQ_LOCATION = 3, REQ_STORAGE = 4;
    static final int RESULT_RELOAD = RESULT_FIRST_USER + 1;
    static final String NAVY = "#1b365d";

    WebView web;
    ProgressBar progress;
    String server;
    String lastUrl;
    ValueCallback<Uri[]> fileCallback;
    Uri cameraUri;
    String pendingLocationId;
    final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor(NAVY));
        getWindow().setNavigationBarColor(Color.parseColor(NAVY));

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP);
        lp.topMargin = -dp(1);
        root.addView(progress, lp);
        setContentView(root);
        configureWebView();

        server = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, null);
        if (server != null && handleSignInLink(getIntent())) return;
        if (server == null) {
            startActivityForResult(new Intent(this, SetupActivity.class), REQ_SETUP);
        } else if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(server + "/dashboard");
        }
    }

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " GreenCycleApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "GreenCycleApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.contains("/api/auth/google/start")) {
                    // Google does not allow its sign-in inside apps; use the phone's browser, which hands back via greencycle://login.
                    String ext = url + (url.contains("?") ? "&" : "?") + "app=1";
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ext)));
                    } catch (ActivityNotFoundException e) {
                        toast("Install Google Chrome to sign in with Google.");
                    }
                    return true;
                }
                if (server != null && url.startsWith(server)) return false;
                if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    toast("No app on this phone can open this link.");
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (url != null && url.startsWith("http")) lastUrl = url;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(PAGE_SCRIPT, null);
                CookieManager.getInstance().flush();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                showOffline(description);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return openFileChooser(callback, params);
            }
        });

        web.setDownloadListener(new android.webkit.DownloadListener() {
            public void onDownloadStart(String url, String userAgent, String disposition, String mime, long length) {
                download(url, userAgent, disposition, mime);
            }
        });
    }

    // ---------- return from Google sign-in ----------

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSignInLink(intent);
    }

    /** greencycle://login?code=… : finish the Google sign-in inside the app. */
    boolean handleSignInLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"greencycle".equals(data.getScheme()) || server == null) return false;
        String code = data.getQueryParameter("code");
        if (code == null) return false;
        web.loadUrl(server + "/api/auth/app-login?code=" + Uri.encode(code));
        return true;
    }

    // ---------- offline / error page ----------

    void showOffline(String reason) {
        String html = "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>body{font-family:sans-serif;margin:0;background:#f1f5f9;color:#0f172a}"
                + ".top{background:" + NAVY + ";color:#fff;padding:28px 22px 22px}.top b{color:#32d583}"
                + ".card{background:#fff;margin:16px;border-radius:14px;padding:18px;box-shadow:0 1px 3px #0002}"
                + "li{margin:6px 0}button{display:block;width:100%;padding:14px;margin-top:12px;border:0;border-radius:10px;font-size:16px;font-weight:600}"
                + ".p{background:#039855;color:#fff}.s{background:#e2e8f0;color:#0f172a}small{color:#64748b}</style></head><body>"
                + "<div class=top><div style='font-size:13px;letter-spacing:.1em'>GREENCYCLE <b>ERP</b></div>"
                + "<h2 style='margin:10px 0 0'>Cannot reach the server</h2></div>"
                + "<div class=card><p>The app could not connect to <b>" + escape(server) + "</b>.</p><ol>"
                + "<li>Does this phone have <b>internet</b>? If the address starts with 192.168, you must be on the <b>office Wi-Fi</b>.</li>"
                + "<li>Is the office computer <b>switched on</b> with <b>START-WINDOWS</b> running?</li>"
                + "<li>First time? On the office computer run <b>ALLOW-PHONES.bat</b> once.</li>"
                + "<li>Has the office computer's address changed? Tap <b>Change server</b>.</li></ol>"
                + "<small>" + escape(reason) + "</small>"
                + "<button class=p onclick='GreenCycleApp.retry()'>Try again</button>"
                + "<button class=s onclick='GreenCycleApp.openSettings()'>Change server</button></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    static String escape(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    // ---------- JavaScript bridge (used by the web app and the offline page) ----------

    /** Replaces window.print and navigator.geolocation, which a WebView on a local http address cannot provide. */
    static final String PAGE_SCRIPT = "(function(){if(window.__gc)return;window.__gc=1;var cb={},n=0;"
            + "window.__gcGeo=function(id,la,lo,ac,err){var c=cb[id];delete cb[id];if(!c)return;"
            + "if(err){c.e&&c.e({code:1,PERMISSION_DENIED:1,message:err});}"
            + "else c.s({coords:{latitude:la,longitude:lo,accuracy:ac,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()});};"
            + "var g={getCurrentPosition:function(s,e){var id='g'+(n++);cb[id]={s:s,e:e};GreenCycleApp.getLocation(id);},"
            + "watchPosition:function(s,e){this.getCurrentPosition(s,e);return 0;},clearWatch:function(){}};"
            + "try{Object.defineProperty(navigator,'geolocation',{value:g,configurable:true});}catch(x){}"
            + "window.print=function(){GreenCycleApp.print(document.title||'GreenCycle');};})();";

    class Bridge {
        @JavascriptInterface
        public boolean isApp() {
            return true;
        }

        @JavascriptInterface
        public String version() {
            return "1.1";
        }

        @JavascriptInterface
        public void openSettings() {
            ui.post(new Runnable() { public void run() {
                Intent i = new Intent(MainActivity.this, SetupActivity.class);
                i.putExtra(SetupActivity.EXTRA_SETTINGS, true);
                startActivityForResult(i, REQ_SETUP);
            }});
        }

        @JavascriptInterface
        public void retry() {
            ui.post(new Runnable() { public void run() { web.loadUrl(lastUrl != null ? lastUrl : server + "/dashboard"); }});
        }

        @JavascriptInterface
        public void print(String title) {
            ui.post(new Runnable() { public void run() {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                pm.print(title, web.createPrintDocumentAdapter(title), null);
            }});
        }

        @JavascriptInterface
        public void getLocation(String id) {
            ui.post(new Runnable() { public void run() {
                pendingLocationId = id;
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                } else {
                    fetchLocation();
                }
            }});
        }
    }

    // ---------- GPS ----------

    void fetchLocation() {
        final String id = pendingLocationId;
        pendingLocationId = null;
        if (id == null) return;
        final LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        boolean gps = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean net = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gps && !net) {
            sendLocation(id, null, "Turn on Location (GPS) in the phone settings and try again.");
            return;
        }
        final boolean[] done = {false};
        final LocationListener listener = new LocationListener() {
            public void onLocationChanged(Location l) {
                if (done[0]) return;
                done[0] = true;
                lm.removeUpdates(this);
                sendLocation(id, l, null);
            }
            public void onStatusChanged(String p, int s, Bundle b) { }
            public void onProviderEnabled(String p) { }
            public void onProviderDisabled(String p) { }
        };
        try {
            if (gps) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0, 0, listener, Looper.getMainLooper());
            if (net) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0, 0, listener, Looper.getMainLooper());
        } catch (SecurityException e) {
            sendLocation(id, null, "Location permission was not given.");
            return;
        }
        ui.postDelayed(new Runnable() { public void run() {
            if (done[0]) return;
            done[0] = true;
            lm.removeUpdates(listener);
            Location best = null;
            try {
                for (String p : lm.getProviders(true)) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                }
            } catch (SecurityException ignored) { }
            sendLocation(id, best, best == null ? "Could not get a GPS fix. Move to an open area and try again." : null);
        }}, 20000);
    }

    void sendLocation(String id, Location l, String error) {
        String js = l != null
                ? "window.__gcGeo('" + id + "'," + l.getLatitude() + "," + l.getLongitude() + "," + l.getAccuracy() + ",null)"
                : "window.__gcGeo('" + id + "',0,0,0," + org.json.JSONObject.quote(error) + ")";
        web.evaluateJavascript(js, null);
    }

    // ---------- photos and file uploads ----------

    boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        cameraUri = null;
        boolean image = false;
        for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image")) image = true;

        Intent camera = null;
        if (image) {
            cameraUri = newPhotoUri();
            if (cameraUri != null) {
                camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        }
        Intent pick = params.createIntent();
        Intent target;
        if (camera != null && params.isCaptureEnabled()) {
            target = camera;
        } else {
            target = Intent.createChooser(pick, image ? "Take or choose a photo" : "Choose a file");
            if (camera != null) target.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(target, REQ_FILE);
        } catch (ActivityNotFoundException e) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
            toast("No camera or file app found on this phone.");
        }
        return true;
    }

    Uri newPhotoUri() {
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return null;
        }
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, "GreenCycle_" + System.currentTimeMillis() + ".jpg");
        v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        if (Build.VERSION.SDK_INT >= 29) v.put("relative_path", "Pictures/GreenCycle");
        try {
            return getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- downloads (invoices, slips, reports) ----------

    void download(final String url, final String userAgent, final String disposition, final String mime) {
        final String name = URLUtil.guessFileName(url, disposition, mime);
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            toast("Allow storage access, then tap download again.");
            return;
        }
        toast("Downloading " + name + "…");
        final String cookie = CookieManager.getInstance().getCookie(url);
        new Thread(new Runnable() { public void run() {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                c.setRequestProperty("User-Agent", userAgent);
                c.setConnectTimeout(15000);
                c.setReadTimeout(60000);
                if (c.getResponseCode() >= 400) throw new Exception("Server answered " + c.getResponseCode());
                String type = c.getContentType() != null ? c.getContentType().split(";")[0] : (mime != null ? mime : "application/octet-stream");
                Uri saved;
                try (InputStream in = c.getInputStream()) {
                    saved = save(in, name, type);
                }
                final Uri open = saved;
                final String t = type;
                ui.post(new Runnable() { public void run() {
                    toast("Saved to Downloads/GreenCycle: " + name);
                    try {
                        Intent view = new Intent(Intent.ACTION_VIEW);
                        view.setDataAndType(open, t);
                        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(view);
                    } catch (Exception ignored) {
                        // No viewer for this file type; it is still in Downloads.
                    }
                }});
            } catch (Exception e) {
                final String err = e.getMessage();
                ui.post(new Runnable() { public void run() { toast("Download failed: " + err); }});
            }
        }}).start();
    }

    @SuppressWarnings("deprecation")
    Uri save(InputStream in, String name, String type) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put("_display_name", name);
            v.put("mime_type", type);
            v.put("relative_path", "Download/GreenCycle");
            Uri uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                copy(in, out);
            }
            return uri;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "GreenCycle");
        dir.mkdirs();
        File f = new File(dir, name);
        try (OutputStream out = new FileOutputStream(f)) {
            copy(in, out);
        }
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        long id = dm.addCompletedDownload(name, "GreenCycle ERP", true, type, f.getAbsolutePath(), f.length(), true);
        return dm.getUriForDownloadedFile(id);
    }

    static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    // ---------- activity plumbing ----------

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == REQ_SETUP) {
            server = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, null);
            if (server == null) {
                finish();
            } else if (result == RESULT_OK) {
                web.clearHistory();
                web.loadUrl(server + "/dashboard");
            } else if (result == RESULT_RELOAD) {
                web.clearCache(true);
                web.loadUrl(server + "/login");
            }
            return;
        }
        if (request == REQ_FILE && fileCallback != null) {
            Uri[] picked = null;
            if (result == RESULT_OK) {
                if (data != null && data.getClipData() != null) {
                    picked = new Uri[data.getClipData().getItemCount()];
                    for (int i = 0; i < picked.length; i++) picked[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data != null && data.getData() != null) {
                    picked = new Uri[]{data.getData()};
                } else if (cameraUri != null) {
                    picked = new Uri[]{cameraUri};
                }
            }
            if (cameraUri != null && (picked == null || picked[0] != cameraUri)) {
                try {
                    getContentResolver().delete(cameraUri, null, null);
                } catch (Exception ignored) { }
            }
            fileCallback.onReceiveValue(picked);
            fileCallback = null;
            cameraUri = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request == REQ_LOCATION) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                fetchLocation();
            } else if (pendingLocationId != null) {
                sendLocation(pendingLocationId, null, "Location permission was not given. Allow it in Settings → Apps → GreenCycle ERP → Permissions.");
                pendingLocationId = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }
}
