package com.callaum.antigravity;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.LocaleList;
import android.os.Looper;
import android.os.Message;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Menu;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.ScriptHandler;
import androidx.webkit.UserAgentMetadata;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 全屏打开 Antigravity 网页版，并在页面里注入中文翻译。 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_MIC = 2;
    private static final int REQ_STORAGE = 3;
    private static final int MAX_MISSING = 1000;
    private static final String REPO_URL =
            "https://github.com/callaumyan-design/dsh/tree/main/antigravity";
    /**
     * 注入脚本和网页消息通道只对 Antigravity 自己的网页开放。
     * 远程控制（连到你自己电脑）的对话界面是嵌在页面里的 iframe，来自 antigravity.static.usercontent.goog。
     */
    private static final Set<String> AG_ORIGINS =
            Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
                    "https://antigravity.google.com",
                    "https://*.antigravity.google.com",
                    "https://antigravity.static.usercontent.goog")));
    /** 某些旧版 WebView 不认通配符时退回用的列表。 */
    private static final Set<String> AG_ORIGINS_EXACT =
            Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
                    "https://antigravity.google.com",
                    "https://antigravity.static.usercontent.goog")));

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> missing = new LinkedHashSet<>();

    private SharedPreferences prefs;
    private Translator translator;
    private FrameLayout root;
    private FrameLayout content;
    private View topScrim;
    private View bottomScrim;
    private WebView web;
    private ProgressBar progress;
    private LinearLayout errorView;
    private TextView errorDetail;
    private FloatingMenuButton fab;

    private FrameLayout popupLayer;
    private WebView popupWebView;
    private TextView popupTitle;
    private boolean popupNavigated;

    private ScriptHandler scriptHandler;
    private boolean documentStartSupported;
    private boolean mainFrameError;
    private boolean leftForSignIn;
    private boolean clearHistoryOnNextPage;
    private String userAgent;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMicRequest;
    private String pendingBlobToken;
    private Object backCallback;
    private boolean backCallbackRegistered;
    private boolean missingDirty;
    private boolean manualDictionaryCheck;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("settings", MODE_PRIVATE);
        // 登录页等 Google 自己的页面按这个语言显示（网页向服务器声明“优先中文”）
        LocaleList.setDefault(new LocaleList(Locale.SIMPLIFIED_CHINESE, Locale.US));
        loadMissing();
        try {
            translator = new Translator(this, prefs);
        } catch (Exception e) {
            translator = null;
            Toast.makeText(this, "翻译词典加载失败，先显示英文", Toast.LENGTH_LONG).show();
        }

        buildLayout();
        setUpWebView(web, false);
        installPageScript();
        installBridge();
        setUpBackHandling();

        String start = startUrl(getIntent());
        if (start != null) {
            web.loadUrl(start);
        } else if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(UrlPolicy.HOME_URL);
        }

        if (translator != null) translator.checkForUpdate(false, this::onDictionaryChecked);
    }

    // ---------------------------------------------------------------- 界面

    private void buildLayout() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        int bg = resolveWindowBackground();

        root = new FrameLayout(this);
        root.setBackgroundColor(bg);
        content = new FrameLayout(this);
        root.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        topScrim = new View(this);
        topScrim.setBackgroundColor(bg);
        root.addView(topScrim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        bottomScrim = new View(this);
        bottomScrim.setBackgroundColor(bg);
        root.addView(bottomScrim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));

        web = new WebView(this);
        web.setBackgroundColor(bg);
        content.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setIndeterminate(false);
        content.addView(progress, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        content.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        fab = new FloatingMenuButton(this, prefs);
        fab.setOnClickListener(v -> showMenu());
        content.addView(fab);
        content.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            if (r - l != or - ol || b - t != ob - ot) fab.post(fab::place);
        });
        fab.post(fab::place);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) content.getLayoutParams();
            lp.setMargins(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            content.setLayoutParams(lp);
            topScrim.getLayoutParams().height = bars.top;
            topScrim.requestLayout();
            bottomScrim.getLayoutParams().height = bars.bottom;
            bottomScrim.requestLayout();
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(root);
        applyBarColors(bg, bg);
    }

    private LinearLayout buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setBackgroundColor(resolveWindowBackground());
        box.setClickable(true);
        TextView title = new TextView(this);
        title.setText("连不上 Antigravity");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        box.addView(title);
        errorDetail = new TextView(this);
        errorDetail.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        errorDetail.setGravity(Gravity.CENTER);
        errorDetail.setPadding(0, dp(12), 0, dp(20));
        box.addView(errorDetail);
        Button retry = new Button(this);
        retry.setText("重试");
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            web.reload();
        });
        box.addView(retry);
        return box;
    }

    private int resolveWindowBackground() {
        TypedValue tv = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.windowBackground, tv, true)
                && tv.type >= TypedValue.TYPE_FIRST_COLOR_INT && tv.type <= TypedValue.TYPE_LAST_COLOR_INT) {
            return tv.data;
        }
        return Color.rgb(0x1f, 0x1f, 0x1f);
    }

    /** 状态栏、导航栏的底色跟网页顶部和底部的颜色一致。 */
    private void applyBarColors(int top, int bottom) {
        topScrim.setBackgroundColor(top);
        bottomScrim.setBackgroundColor(bottom);
        root.setBackgroundColor(bottom);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(isLight(top));
        c.setAppearanceLightNavigationBars(isLight(bottom));
    }

    private static boolean isLight(int color) {
        double y = 0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color);
        return y > 160;
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private void setUpWebView(WebView w, boolean popup) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        s.setUserAgentString(userAgent());
        applyBrowserIdentity(s);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(w, true);

        w.setWebViewClient(popup ? new PopupClient() : new MainClient());
        w.setWebChromeClient(new ChromeClient(popup));
        w.setDownloadListener(this::onDownload);
    }

    /**
     * 用和手机版 Chrome 相同格式的 User-Agent（去掉 WebView 特有的 “wv” 标记）。
     * Google 登录页不接受被识别为“应用内嵌网页”的浏览器。
     */
    private String userAgent() {
        if (userAgent == null) {
            String def = WebSettings.getDefaultUserAgent(this);
            Matcher m = Pattern.compile("Chrome/(\\d+)").matcher(def);
            String major = m.find() ? m.group(1) : "131";
            userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                    + major + ".0.0.0 Mobile Safari/537.36";
        }
        return userAgent;
    }

    /** 网页读到的浏览器品牌（navigator.userAgentData）也写成 Chromium，和上面的 User-Agent 一致。 */
    private void applyBrowserIdentity(WebSettings s) {
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
                String def = WebSettings.getDefaultUserAgent(this);
                Matcher m = Pattern.compile("Chrome/((\\d+)[\\d.]*)").matcher(def);
                String full = m.find() ? m.group(1) : "131.0.0.0";
                String major = full.split("\\.", 2)[0];
                List<UserAgentMetadata.BrandVersion> brands = new ArrayList<>();
                brands.add(new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Chromium").setMajorVersion(major).setFullVersion(full).build());
                brands.add(new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Not_A Brand").setMajorVersion("99").setFullVersion("99.0.0.0").build());
                WebSettingsCompat.setUserAgentMetadata(s, new UserAgentMetadata.Builder()
                        .setBrandVersionList(brands)
                        .setFullVersion(full)
                        .setPlatform("Android")
                        .setPlatformVersion(Build.VERSION.RELEASE)
                        .setModel("")
                        .setMobile(true)
                        .build());
            }
        } catch (RuntimeException ignored) {
            // 旧版 WebView 不支持时保持默认
        }
    }

    /** 每个 Antigravity 页面开始加载时注入：状态栏配色、下载辅助，以及（开启时）中文翻译。 */
    private void installPageScript() {
        if (translator == null) return;
        // 很旧的 WebView 不支持时，退而求其次，页面加载后再注入（见 injectFallback）
        documentStartSupported = false;
        if (scriptHandler != null) scriptHandler.remove();
        scriptHandler = null;
        String script = translator.buildScript(translationOn());
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Set<String> origins;
            try {
                origins = AG_ORIGINS;
                scriptHandler = WebViewCompat.addDocumentStartJavaScript(web, script, origins);
            } catch (IllegalArgumentException e) {
                origins = AG_ORIGINS_EXACT;
                scriptHandler = WebViewCompat.addDocumentStartJavaScript(web, script, origins);
            }
            documentStartSupported = true;
        }
    }

    private void injectFallback(String url) {
        if (translator != null && !documentStartSupported && UrlPolicy.isAntigravity(Uri.parse(url))) {
            web.evaluateJavascript(translator.buildScript(translationOn()), null);
        }
    }

    private void installBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.WebMessageListener listener = (view, message, sourceOrigin, isMainFrame, reply) ->
                onBridgeMessage(message.getData(), isMainFrame);
        try {
            WebViewCompat.addWebMessageListener(web, "AgBridge", AG_ORIGINS, listener);
        } catch (IllegalArgumentException e) {
            WebViewCompat.addWebMessageListener(web, "AgBridge",
                    AG_ORIGINS_EXACT, listener);
        }
    }

    private boolean translationOn() {
        return prefs.getBoolean("translate", true);
    }

    /** 网页通过 AgBridge.postMessage 发来的消息（只有 Antigravity 的页面能发）。 */
    private void onBridgeMessage(String data, boolean isMainFrame) {
        if (data == null) return;
        try {
            JSONObject m = new JSONObject(data);
            switch (m.optString("t")) {
                case "theme": {
                    if (!isMainFrame) return;
                    Integer top = parseCssColor(m.optString("top"));
                    Integer bottom = parseCssColor(m.optString("bottom"));
                    if (top != null) applyBarColors(top, bottom != null ? bottom : top);
                    break;
                }
                case "missing": {
                    JSONArray items = m.optJSONArray("items");
                    if (items == null) return;
                    for (int i = 0; i < items.length() && missing.size() < MAX_MISSING; i++) {
                        String s = items.optString(i, "");
                        if (!s.isEmpty() && s.length() <= 200 && missing.add(s)) missingDirty = true;
                    }
                    break;
                }
                case "blob":
                    onBlobReady(m);
                    break;
                case "blobError":
                    if (TextUtils.equals(pendingBlobToken, m.optString("token"))) {
                        pendingBlobToken = null;
                        toast("下载失败：网页里的文件已经失效，请再点一次下载");
                    }
                    break;
                default:
                    break;
            }
        } catch (JSONException ignored) {
            // 不认识的消息直接忽略
        }
    }

    // ---------------------------------------------------------------- 网址与页面事件

    private boolean handleNavigation(Uri uri) {
        if (UrlPolicy.isHttp(uri)) {
            if (UrlPolicy.stayInApp(uri)) return false;
            openExternal(uri);
            return true;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        switch (scheme) {
            case "about":
            case "data":
            case "blob":
            case "javascript":
                return false;
            case "intent":
                openIntentUri(uri.toString());
                return true;
            default:
                openExternal(uri);
                return true;
        }
    }

    private final class MainClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return handleNavigation(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            mainFrameError = false;
            errorView.setVisibility(View.GONE);
            Uri uri = Uri.parse(url);
            if ("accounts.google.com".equalsIgnoreCase(uri.getHost())) leftForSignIn = true;
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            injectFallback(url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            injectFallback(url);
            if (mainFrameError) {
                errorView.setVisibility(View.VISIBLE);
            }
            Uri uri = Uri.parse(url);
            // 登录完回到 Antigravity 后，清掉登录页的历史，返回键就不会退回登录页
            if ((leftForSignIn || clearHistoryOnNextPage) && UrlPolicy.isAntigravity(uri)) {
                leftForSignIn = false;
                clearHistoryOnNextPage = false;
                view.clearHistory();
                updateBackCallback();
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            updateBackCallback();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            mainFrameError = true;
            errorDetail.setText("请检查网络连接（" + error.getDescription() + "）");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // 网页进程崩溃时重建界面，而不是让整个应用退出
            content.removeView(view);
            view.destroy();
            if (view == web) web = null;
            recreate();
            return true;
        }
    }

    /** 弹出窗口（window.open）：登录、授权页在应用里打开，其他链接交给浏览器。 */
    private final class PopupClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (UrlPolicy.isHttp(uri)) {
                if (popupNavigated || UrlPolicy.stayInApp(uri)) {
                    showPopup(uri);
                    return false;
                }
                openExternal(uri);
                main.post(MainActivity.this::closePopup);
                return true;
            }
            return handleNavigation(uri);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            Uri uri = Uri.parse(url);
            if (!UrlPolicy.isHttp(uri)) return;
            if (popupNavigated || UrlPolicy.stayInApp(uri)) {
                showPopup(uri);
            } else {
                view.stopLoading();
                openExternal(uri);
                main.post(MainActivity.this::closePopup);
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            main.post(MainActivity.this::closePopup);
            return true;
        }
    }

    private final class ChromeClient extends WebChromeClient {
        private final boolean popup;

        ChromeClient(boolean popup) {
            this.popup = popup;
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (popup) return;
            progress.setProgress(newProgress);
            progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            return openPopup(resultMsg);
        }

        @Override
        public void onCloseWindow(WebView window) {
            if (window == popupWebView) closePopup();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            return showFileChooser(callback, params);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            main.post(() -> handlePermissionRequest(request));
        }
    }

    // ---------------------------------------------------------------- 弹出窗口

    private boolean openPopup(Message resultMsg) {
        closePopup();
        WebView w = new WebView(this);
        setUpWebView(w, true);
        popupWebView = w;
        popupNavigated = false;

        popupLayer = new FrameLayout(this);
        popupLayer.setBackgroundColor(resolveWindowBackground());
        popupLayer.setClickable(true);
        popupLayer.setVisibility(View.INVISIBLE);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), 0, dp(12), 0);
        TextView close = new TextView(this);
        close.setText("✕  关闭");
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        close.setPadding(dp(12), dp(12), dp(12), dp(12));
        close.setOnClickListener(v -> closePopup());
        bar.addView(close);
        popupTitle = new TextView(this);
        popupTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        popupTitle.setSingleLine(true);
        popupTitle.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        popupTitle.setGravity(Gravity.END);
        bar.addView(popupTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        column.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        column.addView(w, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        popupLayer.addView(column, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        content.addView(popupLayer, content.indexOfChild(fab), new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(w);
        resultMsg.sendToTarget();
        updateBackCallback();
        return true;
    }

    private void showPopup(Uri uri) {
        popupNavigated = true;
        if (popupLayer != null) popupLayer.setVisibility(View.VISIBLE);
        if (popupTitle != null && uri.getHost() != null) popupTitle.setText(uri.getHost());
    }

    private void closePopup() {
        if (popupWebView == null) return;
        WebView w = popupWebView;
        popupWebView = null;
        content.removeView(popupLayer);
        popupLayer = null;
        popupTitle = null;
        w.stopLoading();
        w.destroy();
        updateBackCallback();
    }

    // ---------------------------------------------------------------- 返回键

    private void setUpBackHandling() {
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = (OnBackInvokedCallback) () -> {
                if (!handleBack()) moveTaskToBack(true);
            };
        }
        updateBackCallback();
    }

    /** 能后退时才接管返回键；退无可退时交给系统（回到桌面，应用保留在后台）。 */
    private void updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33 || backCallback == null) return;
        boolean want = popupWebView != null || (web != null && web.canGoBack());
        OnBackInvokedDispatcher dispatcher = getOnBackInvokedDispatcher();
        if (want && !backCallbackRegistered) {
            dispatcher.registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, (OnBackInvokedCallback) backCallback);
            backCallbackRegistered = true;
        } else if (!want && backCallbackRegistered) {
            dispatcher.unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
            backCallbackRegistered = false;
        }
    }

    private boolean handleBack() {
        if (popupWebView != null) {
            if (popupWebView.canGoBack()) popupWebView.goBack();
            else closePopup();
            return true;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        updateBackCallback();
        return false;
    }

    // Android 13 起由上面的 OnBackInvokedCallback 处理返回；这里只给 Android 8–12 用
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (!handleBack()) moveTaskToBack(true);
    }

    // ---------------------------------------------------------------- 菜单

    private void showMenu() {
        PopupMenu popup = new PopupMenu(this, fab);
        Menu menu = popup.getMenu();
        menu.add(0, 1, 1, "刷新页面");
        menu.add(0, 2, 2, translationOn() ? "显示英文原文" : "显示中文翻译");
        menu.add(0, 3, 3, "未翻译的词条（" + missing.size() + "）");
        menu.add(0, 4, 4, "检查翻译词典更新");
        menu.add(0, 5, 5, "在浏览器中打开");
        menu.add(0, 6, 6, "暂时隐藏这个按钮");
        menu.add(0, 7, 7, "退出登录并清除数据");
        menu.add(0, 8, 8, "关于");
        popup.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    web.reload();
                    return true;
                case 2:
                    prefs.edit().putBoolean("translate", !translationOn()).apply();
                    installPageScript();
                    web.reload();
                    return true;
                case 3:
                    showMissing();
                    return true;
                case 4:
                    if (translator == null) {
                        toast("翻译词典没有加载");
                    } else {
                        toast("正在检查…");
                        manualDictionaryCheck = true;
                        translator.checkForUpdate(true, this::onDictionaryChecked);
                    }
                    return true;
                case 5:
                    String url = web.getUrl();
                    openExternal(Uri.parse(url != null && url.startsWith("http") ? url : UrlPolicy.HOME_URL));
                    return true;
                case 6:
                    fab.setVisibility(View.GONE);
                    toast("按钮已隐藏，重新打开应用就会回来");
                    return true;
                case 7:
                    confirmSignOut();
                    return true;
                case 8:
                    showAbout();
                    return true;
                default:
                    return false;
            }
        });
        popup.show();
    }

    private void onDictionaryChecked(boolean updated, String message) {
        if (updated) {
            installPageScript();
            if (translationOn() && web != null) web.evaluateJavascript(translator.buildLiveUpdateScript(), null);
        }
        // 自动检查只在真的更新了时提示；手动检查总是告诉结果
        if (updated || manualDictionaryCheck) toast(message);
        manualDictionaryCheck = false;
    }

    private void showMissing() {
        if (missing.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("未翻译的词条")
                    .setMessage("目前没有记录到没翻译的英文。用一段时间后再来看看。")
                    .setPositiveButton("好", null)
                    .show();
            return;
        }
        StringBuilder preview = new StringBuilder();
        int i = 0;
        for (String s : missing) {
            if (i++ >= 15) {
                preview.append("…");
                break;
            }
            preview.append("• ").append(s).append('\n');
        }
        new AlertDialog.Builder(this)
                .setTitle("未翻译的词条（" + missing.size() + "）")
                .setMessage("下面这些界面文字还没有中文。复制后发给开发者，就能补进词典：\n\n" + preview)
                .setPositiveButton("复制全部", (d, w) -> {
                    JSONArray arr = new JSONArray();
                    for (String s : missing) arr.put(s);
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("未翻译的词条", arr.toString()));
                    toast("已复制 " + missing.size() + " 条");
                })
                .setNeutralButton("清空", (d, w) -> {
                    missing.clear();
                    missingDirty = true;
                    saveMissing();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void confirmSignOut() {
        new AlertDialog.Builder(this)
                .setTitle("退出登录？")
                .setMessage("会清除本应用保存的登录信息和网页数据，之后需要重新登录。")
                .setPositiveButton("退出登录", (d, w) -> {
                    CookieManager cm = CookieManager.getInstance();
                    cm.removeAllCookies(done -> {
                        cm.flush();
                        WebStorage.getInstance().deleteAllData();
                        web.clearCache(true);
                        web.clearFormData();
                        clearHistoryOnNextPage = true;
                        web.loadUrl(UrlPolicy.HOME_URL);
                    });
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void showAbout() {
        String version;
        try {
            version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            version = "?";
        }
        String dict = translator == null
                ? "未加载"
                : "第 " + translator.revision() + " 版，" + translator.size() + " 条"
                        + (translator.isFromCache() ? "（已在线更新）" : "（内置）");
        new AlertDialog.Builder(this)
                .setTitle("反重力 " + version)
                .setMessage("非官方应用，与 Google 无关。\n\n"
                        + "它在手机上全屏打开 Google Antigravity 的网页版（antigravity.google.com），"
                        + "并把界面上的英文换成中文；对话内容、代码和文件名保持原样。\n\n"
                        + "登录信息只保存在这台手机上。\n\n"
                        + "翻译词典：" + dict)
                .setPositiveButton("好", null)
                .setNeutralButton("项目主页", (d, w) -> openExternal(Uri.parse(REPO_URL)))
                .show();
    }

    // ---------------------------------------------------------------- 文件、下载、权限

    private boolean showFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        Intent intent;
        try {
            intent = params.createIntent();
        } catch (RuntimeException e) {
            intent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        }
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(intent, REQ_FILE);
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            toast("手机上没有可以选择文件的应用");
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] {data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private void onDownload(String url, String ua, String contentDisposition, String mimeType, long length) {
        if (url.startsWith("blob:")) {
            pendingBlobToken = UUID.randomUUID().toString();
            web.evaluateJavascript("window.__agFetchBlob&&window.__agFetchBlob("
                    + JSONObject.quote(url) + "," + JSONObject.quote(mimeType == null ? "" : mimeType) + ","
                    + JSONObject.quote(pendingBlobToken) + ")", null);
            return;
        }
        if (needsStoragePermission()) return;
        if (url.startsWith("data:")) {
            saveDataUrlAsync(url, "", mimeType);
            return;
        }
        try {
            String name = Downloads.enqueue(this, url, ua, contentDisposition, mimeType);
            toast("开始下载：" + name);
        } catch (RuntimeException e) {
            toast("下载失败：" + e.getMessage());
        }
    }

    private void onBlobReady(JSONObject m) {
        if (pendingBlobToken == null || !pendingBlobToken.equals(m.optString("token"))) return;
        pendingBlobToken = null;
        if (needsStoragePermission()) return;
        saveDataUrlAsync(m.optString("data"), m.optString("name"), m.optString("mime"));
    }

    private void saveDataUrlAsync(String dataUrl, String name, String mime) {
        Executors.newSingleThreadExecutor().execute(() -> {
            String message;
            try {
                message = "已保存到“下载”：" + Downloads.saveDataUrl(this, dataUrl, name, mime);
            } catch (Exception e) {
                message = "保存失败：" + e.getMessage();
            }
            String finalMessage = message;
            main.post(() -> toast(finalMessage));
        });
    }

    /** Android 9 及以下写“下载”文件夹要先授权；没授权时先去要权限，返回 true。 */
    private boolean needsStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return false;
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        toast("请允许存储权限，然后再点一次下载");
        return true;
    }

    private void handlePermissionRequest(PermissionRequest request) {
        boolean wantsMic = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
        }
        if (!wantsMic || !UrlPolicy.isAntigravity(request.getOrigin())) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (pendingMicRequest != null) pendingMicRequest.deny();
        pendingMicRequest = request;
        requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_MIC || pendingMicRequest == null) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) pendingMicRequest.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else pendingMicRequest.deny();
        pendingMicRequest = null;
    }

    // ---------------------------------------------------------------- 外部链接

    private void openExternal(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            toast("没有可以打开这个链接的应用");
        }
    }

    /** intent:// 链接：只允许打开对外公开的页面，不能指定本机的具体组件。 */
    private void openIntentUri(String url) {
        try {
            Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            intent.setSelector(null);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null && UrlPolicy.isHttp(Uri.parse(fallback))) openExternal(Uri.parse(fallback));
                else toast("没有可以打开这个链接的应用");
            }
        } catch (java.net.URISyntaxException e) {
            toast("链接格式不对");
        }
    }

    private static String startUrl(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        Uri uri = intent.getData();
        return UrlPolicy.isAntigravity(uri) ? uri.toString() : null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = startUrl(intent);
        if (url != null && web != null) {
            closePopup();
            web.loadUrl(url);
        }
    }

    // ---------------------------------------------------------------- 生命周期

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (fab != null) fab.post(fab::place);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
        saveMissing();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        closePopup();
        if (web != null) {
            content.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void loadMissing() {
        try {
            JSONArray arr = new JSONArray(prefs.getString("missing", "[]"));
            for (int i = 0; i < arr.length() && missing.size() < MAX_MISSING; i++) missing.add(arr.getString(i));
        } catch (JSONException ignored) {
            // 记录坏了就从头开始
        }
    }

    private void saveMissing() {
        if (!missingDirty) return;
        JSONArray arr = new JSONArray();
        for (String s : missing) arr.put(s);
        prefs.edit().putString("missing", arr.toString()).apply();
        missingDirty = false;
    }

    // ---------------------------------------------------------------- 小工具

    /** 解析网页给的 CSS 颜色：rgb(…)、rgba(…) 或 #rrggbb。透明色返回 null。 */
    static Integer parseCssColor(String css) {
        if (css == null) return null;
        String s = css.trim().toLowerCase(Locale.ROOT);
        Matcher m = Pattern.compile("^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+%?))?\\s*\\)$")
                .matcher(s);
        if (m.matches()) {
            if (m.group(4) != null) {
                String a = m.group(4);
                double alpha = a.endsWith("%")
                        ? Double.parseDouble(a.substring(0, a.length() - 1)) / 100
                        : Double.parseDouble(a);
                if (alpha < 0.5) return null;
            }
            return Color.rgb(channel(m.group(1)), channel(m.group(2)), channel(m.group(3)));
        }
        if (s.matches("^#[0-9a-f]{6}$")) return Color.parseColor(s);
        if (s.matches("^#[0-9a-f]{3}$")) {
            return Color.rgb(
                    Integer.parseInt(s.substring(1, 2), 16) * 17,
                    Integer.parseInt(s.substring(2, 3), 16) * 17,
                    Integer.parseInt(s.substring(3, 4), 16) * 17);
        }
        return null;
    }

    private static int channel(String v) {
        return Math.max(0, Math.min(255, (int) Math.round(Double.parseDouble(v))));
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
