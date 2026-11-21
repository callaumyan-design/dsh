package com.smsrelay.secure.core

import org.json.JSONException
import org.json.JSONObject

/**
 * Remote SMS sending: a receiving phone asks the sending phone (the one with the SIM card) to
 * send an SMS on its behalf.
 *
 * Security model
 *  - Commands travel on their own relay topic, encrypted and authenticated with their own key
 *    (both derived from the pairing code), so only phones that know the pairing code can issue
 *    one, and a forwarded SMS can never be replayed as a command.
 *  - Each command carries a timestamp and a unique id: the executor refuses anything older
 *    than [MAX_AGE_MS] and never executes the same id twice.
 *  - The executor must opt in explicitly, applies an hourly limit and notifies its owner of
 *    every SMS it sends.
 */
object Remote {
    const val MAX_AGE_MS = 10 * 60_000L
    const val MAX_BODY_BYTES = 2000 // keeps every encrypted command below the relay's 4 KB limit
    const val MAX_PER_HOUR = 20

    const val ACCEPTED = "accepted"
    const val SENT = "sent"
    const val FAILED = "failed"

    /** sim: -1 = phone's default SIM, 0 = SIM 1, 1 = SIM 2. */
    data class Command(val id: String, val time: Long, val to: String, val body: String, val sim: Int, val from: String)

    data class Result(val id: String, val status: String, val detail: String, val time: Long)

    fun type(json: String): String? = try {
        val o = JSONObject(json)
        if (o.optInt("v") != Payload.VERSION) null else o.optString("t").ifEmpty { "sms" }
    } catch (e: JSONException) {
        null
    }

    fun encodeCommand(c: Command): String = JSONObject()
        .put("v", Payload.VERSION)
        .put("t", "cmd")
        .put("a", "send_sms")
        .put("id", c.id)
        .put("ts", c.time)
        .put("to", c.to)
        .put("body", c.body)
        .put("sim", c.sim)
        .put("from", c.from)
        .toString()

    fun decodeCommand(json: String): Command? = try {
        val o = JSONObject(json)
        val id = o.optString("id")
        if (o.optInt("v") != Payload.VERSION || o.optString("t") != "cmd" || o.optString("a") != "send_sms" ||
            id.isEmpty() || id.length > 64
        ) {
            null
        } else {
            Command(
                id = id,
                time = o.optLong("ts"),
                to = o.optString("to"),
                body = o.optString("body"),
                sim = o.optInt("sim", -1).coerceIn(-1, 1),
                from = o.optString("from").take(100),
            )
        }
    } catch (e: JSONException) {
        null
    }

    fun encodeResult(r: Result): String = JSONObject()
        .put("v", Payload.VERSION)
        .put("t", "result")
        .put("id", r.id)
        .put("status", r.status)
        .put("detail", r.detail)
        .put("ts", r.time)
        .toString()

    fun decodeResult(json: String): Result? = try {
        val o = JSONObject(json)
        val id = o.optString("id")
        val status = o.optString("status")
        if (o.optInt("v") != Payload.VERSION || o.optString("t") != "result" || id.isEmpty() ||
            status !in setOf(ACCEPTED, SENT, FAILED)
        ) {
            null
        } else {
            Result(id, status, o.optString("detail").take(300), o.optLong("ts"))
        }
    } catch (e: JSONException) {
        null
    }

    /** Strips formatting; returns null if this does not look like a phone number. */
    fun normalizeNumber(input: String): String? {
        val s = input.trim().filterNot { it == ' ' || it == '-' || it == '(' || it == ')' }
        val digits = s.removePrefix("+")
        if (digits.length !in 3..20 || !digits.all { it in '0'..'9' }) return null
        return s
    }

    /** Validates a command before sending (controller) or executing (executor). Returns an error or null. */
    fun validate(c: Command, now: Long): String? {
        if (kotlin.math.abs(now - c.time) > MAX_AGE_MS) {
            return "指令已过期（超过 10 分钟，或两台手机时间不一致），为安全起见没有发送"
        }
        return validateContent(c.to, c.body)
    }

    fun validateContent(to: String, body: String): String? {
        if (normalizeNumber(to) == null) return "收件号码格式不正确"
        if (body.isBlank()) return "短信内容为空"
        if (body.toByteArray(Charsets.UTF_8).size > MAX_BODY_BYTES) return "短信内容过长（最多约 600 个汉字）"
        return null
    }
}
