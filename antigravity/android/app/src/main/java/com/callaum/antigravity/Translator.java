package com.callaum.antigravity;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 翻译词典和注入网页的脚本。
 *
 * <p>词典随应用内置一份；应用会定期从 GitHub 取最新的词典（只是数据，不含代码），
 * 这样补充翻译不用重新安装应用。脚本代码始终用应用里自带的那份。
 */
final class Translator {
    interface UpdateCallback {
        /** 在主线程回调。updated 为 true 时词典已换成新版本。 */
        void onResult(boolean updated, String message);
    }

    static final int SCHEMA = 1;
    private static final String DICT_ASSET = "zh-CN.json";
    private static final String CACHE_FILE = "zh-CN.json";
    private static final String[] REMOTE_URLS = {
        "https://raw.githubusercontent.com/callaumyan-design/dsh/main/antigravity/i18n/zh-CN.json",
        "https://cdn.jsdelivr.net/gh/callaumyan-design/dsh@main/antigravity/i18n/zh-CN.json",
    };
    private static final long CHECK_INTERVAL_MS = 12L * 60 * 60 * 1000;
    private static final int MAX_DICT_BYTES = 2 * 1024 * 1024;

    private final Context context;
    private final SharedPreferences prefs;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final String shellJs;
    private final String translatorJs;
    private JSONObject dict;
    private boolean fromCache;
    private boolean checking;

    Translator(Context context, SharedPreferences prefs) throws IOException, JSONException {
        this.context = context.getApplicationContext();
        this.prefs = prefs;
        shellJs = readAsset("shell.js");
        translatorJs = readAsset("translator.js");
        JSONObject bundled = validate(new JSONObject(readAsset(DICT_ASSET)));
        if (bundled == null) throw new JSONException("内置词典格式不对");
        dict = bundled;
        JSONObject cached = readCache();
        if (cached != null && revision(cached) > revision(bundled)) {
            dict = cached;
            fromCache = true;
        }
    }

    /** 每个页面开始加载时注入的脚本。 */
    synchronized String buildScript(boolean translate) {
        StringBuilder sb = new StringBuilder(shellJs.length() + translatorJs.length() + 200_000);
        sb.append(shellJs).append('\n');
        if (translate) {
            JSONObject config = new JSONObject();
            try {
                config.put("revision", revision(dict));
            } catch (JSONException ignored) {
                // put 只在键为空时抛异常
            }
            sb.append(translatorJs).append('\n')
                    .append("__agInstallTranslator(window,").append(config)
                    .append(',').append(dict).append(");\n");
        }
        return sb.toString();
    }

    /** 在已打开的页面里换用新词典，不用刷新。 */
    synchronized String buildLiveUpdateScript() {
        return "window.__agI18n&&window.__agI18n.update(" + dict + ");";
    }

    synchronized int revision() {
        return revision(dict);
    }

    synchronized int size() {
        JSONObject strings = dict.optJSONObject("strings");
        JSONArray patterns = dict.optJSONArray("patterns");
        return (strings == null ? 0 : strings.length()) + (patterns == null ? 0 : patterns.length());
    }

    synchronized boolean isFromCache() {
        return fromCache;
    }

    /** 到 GitHub 取新词典。force 为 false 时每 12 小时最多查一次。 */
    void checkForUpdate(boolean force, UpdateCallback callback) {
        long now = System.currentTimeMillis();
        if (!force && now - prefs.getLong("dict_checked_at", 0) < CHECK_INTERVAL_MS) return;
        synchronized (this) {
            if (checking) return;
            checking = true;
        }
        io.execute(() -> {
            boolean updated = false;
            String message = "没能连上 GitHub，稍后再试";
            for (String url : REMOTE_URLS) {
                try {
                    JSONObject remote = validate(new JSONObject(download(url)));
                    if (remote == null) {
                        message = "网上的词典格式不对，先用现有的";
                        continue;
                    }
                    prefs.edit().putLong("dict_checked_at", System.currentTimeMillis()).apply();
                    synchronized (this) {
                        if (revision(remote) > revision(dict)) {
                            writeCache(remote);
                            dict = remote;
                            fromCache = true;
                            updated = true;
                            message = "翻译词典已更新到第 " + revision(remote) + " 版";
                        } else {
                            message = "翻译词典已是最新（第 " + revision(dict) + " 版）";
                        }
                    }
                    break;
                } catch (IOException | JSONException e) {
                    // 换下一个地址
                }
            }
            synchronized (this) {
                checking = false;
            }
            boolean finalUpdated = updated;
            String finalMessage = message;
            if (callback != null) main.post(() -> callback.onResult(finalUpdated, finalMessage));
        });
    }

    /** 只接受认得的格式：strings 是“英文 → 中文”的对照，patterns 是带占位符的规则。 */
    private static JSONObject validate(JSONObject d) {
        if (d.optInt("schema") != SCHEMA || revision(d) <= 0) return null;
        JSONObject strings = d.optJSONObject("strings");
        if (strings == null) return null;
        Iterator<String> keys = strings.keys();
        while (keys.hasNext()) {
            if (!(strings.opt(keys.next()) instanceof String)) return null;
        }
        JSONArray patterns = d.optJSONArray("patterns");
        if (patterns != null) {
            for (int i = 0; i < patterns.length(); i++) {
                JSONObject p = patterns.optJSONObject(i);
                if (p == null || !(p.opt("re") instanceof String) || !(p.opt("to") instanceof String)) {
                    return null;
                }
            }
        }
        return d;
    }

    private static int revision(JSONObject d) {
        return d.optInt("revision", 0);
    }

    private JSONObject readCache() {
        File f = new File(context.getFilesDir(), CACHE_FILE);
        if (!f.isFile()) return null;
        try (InputStream in = new java.io.FileInputStream(f)) {
            return validate(new JSONObject(readAll(in, MAX_DICT_BYTES)));
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    private void writeCache(JSONObject d) throws IOException {
        File dir = context.getFilesDir();
        File tmp = new File(dir, CACHE_FILE + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(d.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(new File(dir, CACHE_FILE))) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new IOException("保存词典失败");
        }
    }

    private static String download(String address) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(address).openConnection();
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(15_000);
        conn.setUseCaches(false);
        conn.setRequestProperty("Accept", "application/json");
        try {
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
            try (InputStream in = conn.getInputStream()) {
                return readAll(in, MAX_DICT_BYTES);
            }
        } finally {
            conn.disconnect();
        }
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            return readAll(in, 8 * MAX_DICT_BYTES);
        }
    }

    private static String readAll(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() > limit) throw new IOException("文件太大");
        }
        return out.toString("UTF-8");
    }
}
