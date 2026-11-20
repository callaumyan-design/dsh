package com.smsrelay.secure.core

import org.json.JSONException
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import javax.net.ssl.HttpsURLConnection

/**
 * Client for an ntfy relay server (https://ntfy.sh by default, or a self-hosted one).
 *
 * The relay is used purely as a mailbox for already-encrypted envelopes. It never sees a key.
 */
object Ntfy {
    const val DEFAULT_SERVER = "https://ntfy.sh"

    fun base(server: String): String = server.trim().trimEnd('/').ifEmpty { DEFAULT_SERVER }

    private fun auth(token: String?): Map<String, String> =
        if (token.isNullOrBlank()) emptyMap() else mapOf("Authorization" to "Bearer ${token.trim()}")

    fun publish(server: String, topic: String, token: String?, message: String) {
        val headers = HashMap(auth(token))
        // Do not relay through Google Firebase (ntfy.sh feature); our receiver connects directly.
        headers["Firebase"] = "no"
        val r = Http.request(
            "POST",
            base(server) + "/" + topic,
            message.toByteArray(Charsets.UTF_8),
            "text/plain; charset=utf-8",
            headers,
        )
        Http.check(r, "加密推送")
    }

    class Event(val id: String, val time: Long, val message: String)

    /**
     * Opens a long-lived JSON stream and blocks, calling [onMessage] for each message, until the
     * connection drops or [isCancelled] returns true. [onConnection] hands out the connection so
     * another thread can disconnect it to force a reconnect.
     *
     * @param since a message id, a unix timestamp, or a duration such as "10m" (ntfy syntax)
     */
    fun subscribe(
        server: String,
        topic: String,
        token: String?,
        since: String,
        onConnection: (HttpsURLConnection) -> Unit,
        onOpen: () -> Unit,
        onMessage: (Event) -> Unit,
        isCancelled: () -> Boolean,
    ) {
        val url = base(server) + "/" + topic + "/json?since=" + Http.enc(since)
        // ntfy sends a keepalive at least every 45s; anything longer means the stream is dead.
        val c = Http.open(url, connectTimeout = 15_000, readTimeout = 100_000)
        auth(token).forEach { (k, v) -> c.setRequestProperty(k, v) }
        onConnection(c)
        try {
            val code = try {
                c.responseCode
            } catch (e: IOException) {
                throw Http.translate(e)
            }
            if (code !in 200..299) {
                val err = c.errorStream?.use { Http.readLimited(it, 4096) } ?: ""
                Http.check(Http.Response(code, err), "中转服务器")
            }
            BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { reader ->
                while (!isCancelled()) {
                    val line = try {
                        reader.readLine()
                    } catch (e: IOException) {
                        if (isCancelled()) return
                        throw Http.translate(e)
                    } ?: return
                    val ev = parse(line) ?: continue
                    when (ev.first) {
                        "open" -> onOpen()
                        "message" -> ev.second?.let(onMessage)
                    }
                }
            }
        } finally {
            c.disconnect()
        }
    }

    /** Parses one line of the ntfy JSON stream into (event, message). */
    fun parse(line: String): Pair<String, Event?>? {
        if (line.isBlank()) return null
        return try {
            val o = JSONObject(line)
            val event = o.optString("event")
            if (event == "message") {
                event to Event(o.optString("id"), o.optLong("time"), o.optString("message"))
            } else {
                event to null
            }
        } catch (e: JSONException) {
            null
        }
    }
}
