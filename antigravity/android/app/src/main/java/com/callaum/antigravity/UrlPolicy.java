package com.callaum.antigravity;

import android.net.Uri;

import java.util.Locale;
import java.util.regex.Pattern;

/** 决定一个网址留在应用里打开，还是交给系统浏览器。 */
final class UrlPolicy {
    static final String HOME_URL = "https://antigravity.google.com/";

    /** www.google.com、www.google.com.au 这类登录时会跳转经过的域名。 */
    private static final Pattern GOOGLE_HOST =
            Pattern.compile("^(www\\.)?google(\\.[a-z]{2,3}){1,2}$");

    private UrlPolicy() {}

    static boolean isAntigravity(Uri uri) {
        String host = host(uri);
        return isHttp(uri)
                && (host.equals("antigravity.google.com") || host.endsWith(".antigravity.google.com"));
    }

    /** Antigravity 本身，以及登录、授权要经过的页面，留在应用里；其他网址用浏览器打开。 */
    static boolean stayInApp(Uri uri) {
        if (!isHttp(uri)) return false;
        if (isAntigravity(uri)) return true;
        String host = host(uri);
        String path = uri.getPath() == null ? "" : uri.getPath();
        switch (host) {
            case "accounts.google.com":
            case "accounts.youtube.com":
            case "gds.google.com":
            case "consent.google.com":
                return true;
            case "github.com":
                // 连接 GitHub 账号、安装 GitHub App 的授权流程
                return path.startsWith("/login")
                        || path.startsWith("/session")
                        || path.startsWith("/apps/")
                        || path.startsWith("/installations")
                        || path.startsWith("/settings/installations")
                        || path.startsWith("/settings/connections");
            default:
                return GOOGLE_HOST.matcher(host).matches()
                        && (path.startsWith("/accounts") || path.startsWith("/sorry"));
        }
    }

    static boolean isHttp(Uri uri) {
        String scheme = uri.getScheme();
        return "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);
    }

    private static String host(Uri uri) {
        String host = uri.getHost();
        return host == null ? "" : host.toLowerCase(Locale.ROOT);
    }
}
