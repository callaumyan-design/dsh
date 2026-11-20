package com.smsrelay.secure.forward

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import android.telephony.SubscriptionManager
import com.smsrelay.secure.core.Filter
import com.smsrelay.secure.core.PhoneNumbers
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.data.Settings
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Receives SMS from the system. Declared with android:permission="android.permission.BROADCAST_SMS",
 * so only the telephony system itself can deliver to it — no other app can inject fake SMS.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val settings = Settings(context)
        if (!settings.forwardEnabled) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val subId = intent.getIntExtra(
            "android.telephony.extra.SUBSCRIPTION_INDEX",
            intent.getIntExtra("subscription", -1),
        )
        val sim = simLabel(subId)
        val now = System.currentTimeMillis()

        // One intent can carry the parts of a long SMS; join them per sender.
        val bySender = LinkedHashMap<String, StringBuilder>()
        for (m in messages) {
            if (m == null) continue
            val from = m.displayOriginatingAddress ?: m.originatingAddress ?: "未知号码"
            bySender.getOrPut(from) { StringBuilder() }.append(m.displayMessageBody ?: m.messageBody ?: "")
        }

        var queued = false
        for ((from, body) in bySender) {
            val text = body.toString()
            // Never forward the SMS we ourselves forwarded (prevents ping-pong between two phones).
            if (settings.smsEnabled && PhoneNumbers.same(from, settings.smsTarget) && text.startsWith("[转发]")) continue
            if (!Filter.allows(settings.filterMode, settings.includeKeywords, settings.excludeKeywords, from, text)) continue
            val sms = Sms(Sms.newUid(), from, text, now, sim, settings.deviceLabel, subId)
            if (Forwarder.enqueue(context, sms)) queued = true
        }
        if (!queued) return

        val pending = goAsync()
        val finished = AtomicBoolean(false)
        val finish = {
            if (finished.compareAndSet(false, true)) pending.finish()
        }
        // Delivery keeps running after this; the receiver just must not block for too long.
        Handler(Looper.getMainLooper()).postDelayed(finish, 9_000)
        Forwarder.kick(context, finish)
    }

    private fun simLabel(subId: Int): String? {
        if (subId < 0 || Build.VERSION.SDK_INT < 29) return null
        val slot = SubscriptionManager.getSlotIndex(subId)
        return if (slot >= 0) "卡${slot + 1}" else null
    }
}
