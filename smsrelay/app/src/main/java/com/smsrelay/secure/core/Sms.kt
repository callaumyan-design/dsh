package com.smsrelay.secure.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/** One received SMS (multi-part messages already joined). */
data class Sms(
    val uid: String,
    val sender: String,
    val body: String,
    val time: Long,
    val sim: String?,
    val device: String,
    val subId: Int = -1,
) {
    companion object {
        fun newUid(): String = UUID.randomUUID().toString()

        fun test(device: String) = Sms(
            uid = newUid(),
            sender = "测试消息",
            body = "这是一条来自「短信安全转发」的测试消息，看到它说明这个通道已经配置成功。示例验证码 246810（仅供测试）。",
            time = System.currentTimeMillis(),
            sim = null,
            device = device,
        )
    }
}

/** Human-readable renderings used by the email / SMS / bot channels. */
object Formatter {
    fun time(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(ms))

    fun shortTime(ms: Long): String =
        SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(ms))

    fun title(sms: Sms): String = "短信 · ${sms.sender}"

    fun footer(sms: Sms): String = buildString {
        append(time(sms.time)).append(" · ").append(sms.device)
        sms.sim?.let { append(" · ").append(it) }
    }

    fun plain(sms: Sms): String = buildString {
        append("【短信转发】来自 ").append(sms.sender).append('\n')
        append(sms.body).append('\n')
        append("—— ").append(footer(sms))
    }

    /** Compact form for the SMS channel, where every character costs money. */
    fun compact(sms: Sms): String = "[转发]${sms.sender}: ${sms.body}"

    fun emailSubject(sms: Sms): String {
        val preview = sms.body.replace(Regex("\\s+"), " ").trim()
        val cut = if (preview.codePointCount(0, preview.length) > 24) {
            preview.substring(0, preview.offsetByCodePoints(0, 24)) + "…"
        } else {
            preview
        }
        return "短信 ${sms.sender}: $cut"
    }
}
