package com.smsrelay.secure.core

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.MalformedURLException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException

/**
 * A delivery failure. [permanent] = retrying will not help (wrong password, bad address...),
 * otherwise the forwarder retries later with back-off.
 */
open class DeliveryException(message: String, val permanent: Boolean = false, cause: Throwable? = null) :
    IOException(message, cause)

/**
 * Minimal HTTPS client on top of the platform HttpsURLConnection.
 * Plain HTTP is refused outright, redirects are not followed, and the platform's certificate
 * and hostname verification are always in effect.
 */
object Http {
    class Response(val code: Int, val body: String)

    var userAgent = "SmsRelay/1.0"

    fun requireHttps(url: String): URL {
        val u = try {
            URL(url.trim())
        } catch (e: MalformedURLException) {
            throw DeliveryException("网址格式不正确", permanent = true)
        }
        if (u.protocol != "https" || u.host.isNullOrEmpty()) {
            throw DeliveryException("为了安全，只允许 https:// 开头的网址", permanent = true)
        }
        return u
    }

    fun open(url: String, connectTimeout: Int = 10_000, readTimeout: Int = 15_000): HttpsURLConnection {
        val c = requireHttps(url).openConnection() as HttpsURLConnection
        c.connectTimeout = connectTimeout
        c.readTimeout = readTimeout
        c.instanceFollowRedirects = false
        c.useCaches = false
        c.setRequestProperty("User-Agent", userAgent)
        return c
    }

    fun request(
        method: String,
        url: String,
        body: ByteArray? = null,
        contentType: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): Response {
        val c = open(url)
        try {
            c.requestMethod = method
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (body != null) {
                c.doOutput = true
                if (contentType != null) c.setRequestProperty("Content-Type", contentType)
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val text = stream?.use { readLimited(it, 64 * 1024) } ?: ""
            return Response(code, text)
        } catch (e: DeliveryException) {
            throw e
        } catch (e: IOException) {
            throw translate(e)
        } finally {
            c.disconnect()
        }
    }

    fun postJson(url: String, json: String, headers: Map<String, String> = emptyMap()): Response =
        request("POST", url, json.toByteArray(Charsets.UTF_8), "application/json; charset=utf-8", headers)

    fun postForm(url: String, form: Map<String, String>): Response {
        val body = form.entries.joinToString("&") { (k, v) -> enc(k) + "=" + enc(v) }
        return request("POST", url, body.toByteArray(Charsets.UTF_8), "application/x-www-form-urlencoded; charset=utf-8")
    }

    fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    /** Throws a meaningful [DeliveryException] for non-2xx responses. */
    fun check(r: Response, service: String): Response {
        if (r.code in 200..299) return r
        val permanent = r.code in 400..499 && r.code != 408 && r.code != 429
        val hint = when (r.code) {
            401, 403 -> "认证失败（密钥/令牌不正确或无权限）"
            404 -> "地址不存在（请检查网址或密钥）"
            413 -> "消息过大"
            429 -> "请求太频繁，稍后自动重试"
            in 500..599 -> "服务器暂时故障，稍后自动重试"
            else -> "服务器返回错误"
        }
        throw DeliveryException("$service：$hint（HTTP ${r.code}）", permanent)
    }

    fun translate(e: IOException): DeliveryException = when (e) {
        is UnknownHostException -> DeliveryException("无法解析服务器地址，请检查网络", cause = e)
        is SocketTimeoutException -> DeliveryException("连接超时，请检查网络", cause = e)
        is SSLException -> DeliveryException("安全连接失败（证书校验未通过）", cause = e)
        else -> DeliveryException("网络错误：${e.message ?: e.javaClass.simpleName}", cause = e)
    }

    fun readLimited(input: InputStream, limit: Int): String {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < limit) {
            val n = input.read(buf, 0, minOf(buf.size, limit - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toString("UTF-8")
    }
}
