package com.smsrelay.secure.core

import org.json.JSONException
import org.json.JSONObject

/**
 * Plaintext format inside the end-to-end encrypted envelope.
 *
 * Long messages are split so that every encrypted relay message stays well below the relay's
 * 4096-byte limit; the receiver reassembles them by uid.
 */
object Payload {
    const val VERSION = 1
    const val MAX_CHUNK_BYTES = 2000

    data class Part(
        val uid: String,
        val sender: String,
        val body: String,
        val time: Long,
        val sim: String?,
        val device: String,
        val index: Int,
        val total: Int,
    )

    fun encode(sms: Sms): List<String> {
        val chunks = splitUtf8(sms.body, MAX_CHUNK_BYTES)
        return chunks.mapIndexed { i, chunk ->
            JSONObject()
                .put("v", VERSION)
                .put("t", "sms")
                .put("id", sms.uid)
                .put("from", sms.sender)
                .put("body", chunk)
                .put("ts", sms.time)
                .put("sim", sms.sim ?: "")
                .put("dev", sms.device)
                .put("p", i)
                .put("n", chunks.size)
                .toString()
        }
    }

    fun decode(json: String): Part? = try {
        val o = JSONObject(json)
        if (o.optInt("v") != VERSION || o.optString("t").ifEmpty { "sms" } != "sms") {
            null
        } else {
            val total = o.getInt("n")
            val index = o.getInt("p")
            val uid = o.getString("id")
            if (total !in 1..200 || index !in 0 until total || uid.isEmpty() || uid.length > 64) {
                null
            } else {
                Part(
                    uid = uid,
                    sender = o.optString("from").take(100),
                    body = o.optString("body"),
                    time = o.optLong("ts"),
                    sim = o.optString("sim").ifEmpty { null },
                    device = o.optString("dev").take(100),
                    index = index,
                    total = total,
                )
            }
        }
    } catch (e: JSONException) {
        null
    }

    /** Splits text into pieces of at most [maxBytes] UTF-8 bytes, never inside a code point. */
    fun splitUtf8(text: String, maxBytes: Int): List<String> {
        if (text.isEmpty()) return listOf("")
        val out = ArrayList<String>()
        val sb = StringBuilder()
        var bytes = 0
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            val n = Character.charCount(cp)
            val len = when {
                cp < 0x80 -> 1
                cp < 0x800 -> 2
                cp < 0x10000 -> 3
                else -> 4
            }
            if (bytes + len > maxBytes && sb.isNotEmpty()) {
                out.add(sb.toString())
                sb.setLength(0)
                bytes = 0
            }
            sb.append(text, i, i + n)
            bytes += len
            i += n
        }
        if (sb.isNotEmpty()) out.add(sb.toString())
        return out
    }
}
