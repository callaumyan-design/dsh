package com.smsrelay.secure.forward

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import com.smsrelay.secure.core.Bark
import com.smsrelay.secure.core.DeliveryException
import com.smsrelay.secure.core.E2E
import com.smsrelay.secure.core.Formatter
import com.smsrelay.secure.core.Ntfy
import com.smsrelay.secure.core.Pairing
import com.smsrelay.secure.core.Payload
import com.smsrelay.secure.core.PhoneNumbers
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.core.SmtpClient
import com.smsrelay.secure.core.SmtpConfig
import com.smsrelay.secure.core.Telegram
import com.smsrelay.secure.core.Webhook
import com.smsrelay.secure.data.Settings

/** Sends one SMS over one channel. Throws [DeliveryException] on failure. */
object Channels {

    fun send(context: Context, s: Settings, channel: String, sms: Sms) {
        when (channel) {
            Settings.CH_E2E -> sendE2E(s, sms)
            Settings.CH_EMAIL -> sendEmail(s, sms)
            Settings.CH_SMS -> sendSms(context, s, sms)
            Settings.CH_BARK -> sendBark(s, sms)
            Settings.CH_TG -> Telegram.send(s.tgToken, s.tgChatId, Formatter.plain(sms))
            Settings.CH_WEBHOOK -> {
                if (s.whUrl.isBlank()) throw DeliveryException("没有填写机器人 Webhook 地址", true)
                Webhook.send(s.whType, s.whUrl, s.whSecret, sms)
            }
            else -> throw DeliveryException("未知通道", true)
        }
    }

    private fun sendE2E(s: Settings, sms: Sms) {
        val code = s.e2eCode
        if (Pairing.normalize(code) == null) throw DeliveryException("还没有生成配对码", true)
        val keys = E2E.derive(code)
        for (part in Payload.encode(sms)) {
            Ntfy.publish(s.e2eServer, keys.topic, s.e2eToken, E2E.seal(keys, part.toByteArray(Charsets.UTF_8)))
        }
    }

    private fun sendEmail(s: Settings, sms: Sms) {
        val to = s.emailTo.split(',', '，', ';', '；', ' ', '\n').map { it.trim() }.filter { it.isNotEmpty() }
        if (s.smtpUser.isBlank() || s.smtpPass.isBlank()) throw DeliveryException("邮箱账号或授权码未填写", true)
        val cfg = SmtpConfig(
            host = s.smtpHost.trim(),
            port = s.smtpPort,
            startTls = s.smtpStartTls,
            username = s.smtpUser.trim(),
            password = s.smtpPass,
            from = s.smtpUser.trim(),
            to = to.ifEmpty { listOf(s.smtpUser.trim()) },
        )
        SmtpClient().send(cfg, Formatter.emailSubject(sms), Formatter.plain(sms))
    }

    private fun sendBark(s: Settings, sms: Sms) {
        if (s.barkDeviceKey.isBlank()) throw DeliveryException("没有填写 Bark Device Key", true)
        val key = if (s.barkEncrypt) s.barkKey.ifEmpty { throw DeliveryException("Bark 加密密钥丢失，请重新生成", true) } else null
        Bark.send(s.barkServer, s.barkDeviceKey, Formatter.title(sms), sms.body + "\n—— " + Formatter.footer(sms), key)
    }

    private val smsSendTimes = ArrayDeque<Long>()

    private fun sendSms(context: Context, s: Settings, sms: Sms) {
        val target = s.smsTarget.trim()
        if (PhoneNumbers.digits(target).length < 3) throw DeliveryException("没有填写接收短信的号码", true)
        if (context.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            throw DeliveryException("没有“发送短信”权限，请在首页授权", true)
        }
        // Loop / runaway protection: at most 30 forwarded SMS per hour.
        synchronized(smsSendTimes) {
            val now = System.currentTimeMillis()
            while (smsSendTimes.isNotEmpty() && smsSendTimes.first() < now - 3600_000) smsSendTimes.removeFirst()
            if (smsSendTimes.size >= 30) throw DeliveryException("一小时内短信转发超过 30 条，已暂停以防循环转发", true)
            smsSendTimes.addLast(now)
        }
        val sub = if (sms.subId >= 0) sms.subId else SubscriptionManager.getDefaultSmsSubscriptionId()
        val validSub = sub >= 0 && sub != Int.MAX_VALUE
        val mgr: SmsManager = if (Build.VERSION.SDK_INT >= 31) {
            val base = context.getSystemService(SmsManager::class.java)
            if (validSub) base.createForSubscriptionId(sub) else base
        } else {
            @Suppress("DEPRECATION")
            if (validSub) SmsManager.getSmsManagerForSubscriptionId(sub) else SmsManager.getDefault()
        }
        try {
            val parts = mgr.divideMessage(Formatter.compact(sms))
            mgr.sendMultipartTextMessage(target, null, parts, null, null)
        } catch (e: RuntimeException) {
            throw DeliveryException("短信发送失败：${e.message ?: e.javaClass.simpleName}")
        }
    }
}
