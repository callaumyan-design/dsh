package com.smsrelay.secure.core

import org.json.JSONException
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

private val ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

fun randomAlnum(len: Int, random: SecureRandom = SecureRandom()): String =
    buildString { repeat(len) { append(ALNUM[random.nextInt(ALNUM.length)]) } }

/** Random key that is easy to type by hand: lower case, no look-alikes (0/o, 1/l/i). ~4.95 bits/char. */
fun typeableKey(len: Int, random: SecureRandom = SecureRandom()): String {
    val alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return buildString { repeat(len) { append(alphabet[random.nextInt(alphabet.length)]) } }
}

/**
 * Bark (open-source push app for iPhone). With encryption on, the Bark server and Apple's push
 * service only see ciphertext; the iPhone decrypts it locally with the key configured in Bark.
 */
object Bark {
    const val DEFAULT_SERVER = "https://api.day.app"

    /** AES-CBC with PKCS#7 padding, as specified by Bark. Key length selects AES-128/192/256. */
    fun encrypt(json: String, key: String, iv: String): String {
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(key.toByteArray(Charsets.UTF_8), "AES"),
            IvParameterSpec(iv.toByteArray(Charsets.UTF_8)),
        )
        return Base64.getEncoder().encodeToString(cipher.doFinal(json.toByteArray(Charsets.UTF_8)))
    }

    fun send(server: String, deviceKey: String, title: String, body: String, encryptionKey: String?) {
        val key = deviceKey.trim()
        if (key.isEmpty() || !key.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
            throw DeliveryException("Bark：Device Key 格式不正确", true)
        }
        val url = server.trim().trimEnd('/').ifEmpty { DEFAULT_SERVER } + "/" + key
        val form = if (encryptionKey.isNullOrEmpty()) {
            mapOf("title" to title, "body" to body, "group" to "短信转发")
        } else {
            if (encryptionKey.length != 32) throw DeliveryException("Bark：加密密钥必须是 32 位", true)
            val iv = randomAlnum(16)
            val json = JSONObject().put("title", title).put("body", body).put("group", "短信转发").toString()
            mapOf("ciphertext" to encrypt(json, encryptionKey, iv), "iv" to iv)
        }
        val r = Http.check(Http.postForm(url, form), "Bark")
        val code = jsonInt(r.body, "code")
        if (code != null && code != 200) throw DeliveryException("Bark：${jsonStr(r.body, "message") ?: "推送失败"}")
    }
}

object Telegram {
    private val TOKEN = Regex("^[0-9]{5,}:[A-Za-z0-9_-]{20,}$")

    private fun base(token: String): String {
        val t = token.trim()
        if (!TOKEN.matches(t)) throw DeliveryException("Telegram：Bot Token 格式不正确", true)
        return "https://api.telegram.org/bot$t"
    }

    fun send(token: String, chatId: String, text: String) {
        if (chatId.isBlank()) throw DeliveryException("Telegram：没有填写 Chat ID", true)
        val json = JSONObject()
            .put("chat_id", chatId.trim())
            .put("text", text.take(4000))
            .put("disable_web_page_preview", true)
            .toString()
        val r = Http.postJson(base(token) + "/sendMessage", json)
        if (r.code == 400 || r.code == 403) {
            throw DeliveryException("Telegram：${jsonStr(r.body, "description") ?: "Chat ID 不正确或机器人未被启用"}", true)
        }
        Http.check(r, "Telegram")
    }

    /** Returns the chat id of the most recent message sent to the bot, or null. */
    fun latestChatId(token: String): String? {
        val r = Http.check(Http.request("GET", base(token) + "/getUpdates"), "Telegram")
        return try {
            val arr = JSONObject(r.body).optJSONArray("result") ?: return null
            for (i in arr.length() - 1 downTo 0) {
                val u = arr.getJSONObject(i)
                val msg = u.optJSONObject("message") ?: u.optJSONObject("channel_post") ?: continue
                val chat = msg.optJSONObject("chat") ?: continue
                if (chat.has("id")) return chat.get("id").toString()
            }
            null
        } catch (e: JSONException) {
            null
        }
    }
}

/** Group-chat bots of common messaging apps, plus a generic JSON webhook. */
object Webhook {
    const val WECOM = 0
    const val DINGTALK = 1
    const val FEISHU = 2
    const val CUSTOM = 3
    val NAMES = listOf("企业微信群机器人", "钉钉群机器人", "飞书群机器人", "自定义 JSON")

    fun send(type: Int, url: String, secret: String?, sms: Sms, now: Long = System.currentTimeMillis()) {
        val text = Formatter.plain(sms)
        val (finalUrl, json) = build(type, url.trim(), secret?.trim(), sms, text, now)
        val r = Http.check(Http.postJson(finalUrl, json), NAMES.getOrElse(type) { "Webhook" })
        // The bot APIs report errors in the JSON body with HTTP 200.
        val err = jsonInt(r.body, "errcode") ?: jsonInt(r.body, "code") ?: jsonInt(r.body, "StatusCode")
        if (type != CUSTOM && err != null && err != 0) {
            val msg = jsonStr(r.body, "errmsg") ?: jsonStr(r.body, "msg") ?: "错误码 $err"
            throw DeliveryException("${NAMES[type]}：$msg")
        }
    }

    fun build(type: Int, url: String, secret: String?, sms: Sms, text: String, now: Long): Pair<String, String> {
        Http.requireHttps(url)
        return when (type) {
            WECOM -> url to JSONObject().put("msgtype", "text")
                .put("text", JSONObject().put("content", text)).toString()

            DINGTALK -> {
                var u = url
                if (!secret.isNullOrEmpty()) {
                    val sign = Base64.getEncoder().encodeToString(hmac(secret, "$now\n$secret"))
                    u += (if (u.contains('?')) "&" else "?") + "timestamp=$now&sign=" + Http.enc(sign)
                }
                u to JSONObject().put("msgtype", "text")
                    .put("text", JSONObject().put("content", text)).toString()
            }

            FEISHU -> {
                val o = JSONObject().put("msg_type", "text").put("content", JSONObject().put("text", text))
                if (!secret.isNullOrEmpty()) {
                    val ts = (now / 1000).toString()
                    // Feishu: HMAC-SHA256 keyed with "timestamp\nsecret" over an empty message.
                    o.put("timestamp", ts).put("sign", Base64.getEncoder().encodeToString(hmac("$ts\n$secret", "")))
                }
                url to o.toString()
            }

            else -> url to JSONObject()
                .put("from", sms.sender)
                .put("body", sms.body)
                .put("time", sms.time)
                .put("time_text", Formatter.time(sms.time))
                .put("device", sms.device)
                .put("sim", sms.sim ?: "")
                .put("text", text)
                .toString()
        }
    }

    private fun hmac(key: String, data: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(data.toByteArray(Charsets.UTF_8))
    }
}

internal fun jsonInt(body: String, key: String): Int? = try {
    val o = JSONObject(body)
    if (o.has(key)) o.getInt(key) else null
} catch (e: JSONException) {
    null
}

internal fun jsonStr(body: String, key: String): String? = try {
    JSONObject(body).optString(key).ifEmpty { null }
} catch (e: JSONException) {
    null
}
