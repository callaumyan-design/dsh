package com.callaum.antigravity;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** 把网页里的下载保存到手机的“下载”文件夹。 */
final class Downloads {
    private Downloads() {}

    /** 普通网址交给系统下载器，带上登录 Cookie。返回文件名。 */
    static String enqueue(Context context, String url, String userAgent, String contentDisposition, String mimeType) {
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) request.addRequestHeader("Cookie", cookies);
        if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
        request.setTitle(name);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        dm.enqueue(request);
        return name;
    }

    /** 保存 data: 网址（网页用 blob 生成的文件也会先转成这种格式）。返回实际保存的文件名。 */
    static String saveDataUrl(Context context, String dataUrl, String suggestedName, String fallbackMime)
            throws IOException {
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:") || comma < 0) throw new IOException("不是 data: 网址");
        String meta = dataUrl.substring(5, comma);
        boolean base64 = meta.endsWith(";base64");
        String mime = (base64 ? meta.substring(0, meta.length() - 7) : meta).split(";", 2)[0];
        if (mime.isEmpty()) mime = fallbackMime == null || fallbackMime.isEmpty() ? "application/octet-stream" : fallbackMime;
        String payload = dataUrl.substring(comma + 1);
        byte[] bytes;
        try {
            bytes = base64
                    ? Base64.decode(payload, Base64.DEFAULT)
                    : URLDecoder.decode(payload, "UTF-8").getBytes(StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            throw new IOException("文件内容无法解码", e);
        }
        String name = fileName(suggestedName, mime);
        return save(context, name, mime, bytes);
    }

    private static String fileName(String suggested, String mime) {
        String name = suggested == null ? "" : suggested.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) {
            name = "antigravity-" + System.currentTimeMillis();
        }
        if (name.indexOf('.') < 0) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) name = name + "." + ext;
        }
        return name.length() > 120 ? name.substring(name.length() - 120) : name;
    }

    private static String save(Context context, String name, String mime, byte[] bytes) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("无法在“下载”文件夹里新建文件");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("无法写入文件");
                out.write(bytes);
            } catch (IOException e) {
                resolver.delete(uri, null, null);
                throw e;
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return name;
        }
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法打开“下载”文件夹");
        File file = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; file.exists(); i++) file = new File(dir, stem + " (" + i + ")" + ext);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        MediaScannerConnection.scanFile(context, new String[] {file.getAbsolutePath()}, new String[] {mime}, null);
        return file.getName();
    }
}
