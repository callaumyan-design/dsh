package com.smsrelay.secure.remote

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import com.smsrelay.secure.Notifier
import com.smsrelay.secure.core.DeliveryException
import com.smsrelay.secure.core.E2E
import com.smsrelay.secure.core.Ntfy
import com.smsrelay.secure.core.Pairing
import com.smsrelay.secure.core.Remote
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.data.Settings
import java.util.concurrent.Executors

/**
 * Remote SMS sending.
 *  - Controller (receiving phone): [request] publishes an encrypted command; [onResult] tracks replies.
 *  - Executor (sending phone, with the SIM): [execute] validates and sends; replies with the outcome.
 */
object RemoteSms {
    const val STATUS_WAITING = "waiting"
    const val STATUS_SENDING = "sending"

    private val io = Executors.newSingleThreadExecutor()

    // ------------------------------------------------------------------ controller

    /** Sends a remote-SMS command. Blocking (call off the main thread). Returns an error message or null. */
    fun request(context: Context, to: String, body: String, sim: Int): String? {
        val s = Settings(context)
        if (!s.receiverConfigured()) return "请先在上面填写配对码并开启接收"
        Remote.validateContent(to, body)?.let { return it }
        val cmd = Remote.Command(Sms.newUid(), System.currentTimeMillis(), Remote.normalizeNumber(to)!!, body.trim(), sim, s.deviceLabel)
        val db = Db.get(context)
        db.insertRemote(Db.ROLE_OUT, cmd.id, cmd.to, cmd.body, cmd.sim, s.deviceLabel, STATUS_WAITING, cmd.time)
        return try {
            val keys = E2E.deriveCommand(s.rxCode)
            Ntfy.publish(s.rxServer, keys.topic, s.rxToken, E2E.seal(keys, Remote.encodeCommand(cmd).toByteArray(Charsets.UTF_8)))
            null
        } catch (e: Exception) {
            val msg = (e as? DeliveryException)?.message ?: "发送指令失败：${e.message ?: e.javaClass.simpleName}"
            db.updateRemote(Db.ROLE_OUT, cmd.id, Remote.FAILED, msg)
            msg
        }
    }

    /** A reply from the sending phone. Only moves forward (waiting → accepted → sent/failed). */
    fun onResult(context: Context, r: Remote.Result) {
        val db = Db.get(context)
        val item = db.getRemote(Db.ROLE_OUT, r.id) ?: return // not a command this phone issued
        if (rank(r.status) <= rank(item.status)) return
        db.updateRemote(Db.ROLE_OUT, r.id, r.status, r.detail)
        if (r.status != Remote.ACCEPTED) Notifier.remoteResult(context, item.to, item.body, r.status == Remote.SENT, r.detail)
    }

    private fun rank(status: String) = when (status) {
        STATUS_WAITING -> 0
        Remote.ACCEPTED -> 1
        else -> 2
    }

    // ------------------------------------------------------------------ executor

    fun execute(context: Context, cmd: Remote.Command) {
        val s = Settings(context)
        if (!s.remoteSmsEnabled) return // not opted in: ignore entirely
        val db = Db.get(context)
        val now = System.currentTimeMillis()
        // Recorded before anything else, so the same command id can never be executed twice.
        if (!db.insertRemote(Db.ROLE_IN, cmd.id, cmd.to, cmd.body, cmd.sim, cmd.from, STATUS_SENDING, now)) return

        val error = Remote.validate(cmd, now)
            ?: if (context.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
                "发送端没有“发送短信”权限"
            } else if (db.remoteExecutedLastHour() > Remote.MAX_PER_HOUR) {
                "一小时内远程发短信超过 ${Remote.MAX_PER_HOUR} 条，已暂停（安全限制）"
            } else {
                null
            }
        if (error != null) {
            finish(context, cmd.id, false, error)
            return
        }
        reply(context, cmd.id, Remote.ACCEPTED, "发送端已收到，正在发送")
        try {
            val subId = subIdForSlot(context, cmd.sim)
            if (cmd.sim >= 0 && Build.VERSION.SDK_INT >= 29 && subId < 0) {
                finish(context, cmd.id, false, "发送端找不到卡${cmd.sim + 1}（可能没有插卡）")
                return
            }
            val mgr = smsManager(context, subId)
            val parts = mgr.divideMessage(cmd.body)
            db.setRemoteParts(cmd.id, parts.size)
            val sent = ArrayList<PendingIntent>(parts.size)
            for (i in parts.indices) {
                val intent = Intent(context, SmsSentReceiver::class.java)
                    .setData(Uri.parse("smsrelay://sent/${cmd.id}/$i"))
                    .putExtra(SmsSentReceiver.EXTRA_ID, cmd.id)
                sent += PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)
            }
            mgr.sendMultipartTextMessage(cmd.to, null, parts, sent, null)
        } catch (e: RuntimeException) {
            finish(context, cmd.id, false, "短信发送失败：${e.message ?: e.javaClass.simpleName}")
        }
    }

    /** Final outcome on the executor: record it, tell the owner, and reply to the controller. */
    fun finish(context: Context, id: String, ok: Boolean, detail: String) {
        val db = Db.get(context)
        db.updateRemote(Db.ROLE_IN, id, if (ok) Remote.SENT else Remote.FAILED, detail)
        db.getRemote(Db.ROLE_IN, id)?.let { Notifier.remoteExecuted(context, it.to, it.body, it.device, ok, detail) }
        reply(context, id, if (ok) Remote.SENT else Remote.FAILED, detail)
    }

    /** Best-effort encrypted reply on the normal (sending → receiving) channel. Blocking. */
    private fun reply(context: Context, id: String, status: String, detail: String) {
        val s = Settings(context)
        if (Pairing.normalize(s.e2eCode) == null) return
        val keys = E2E.derive(s.e2eCode)
        val msg = E2E.seal(keys, Remote.encodeResult(Remote.Result(id, status, detail, System.currentTimeMillis())).toByteArray(Charsets.UTF_8))
        for (attempt in 0 until 3) {
            try {
                Ntfy.publish(s.e2eServer, keys.topic, s.e2eToken, msg)
                return
            } catch (e: Exception) {
                try {
                    Thread.sleep(2_000L * (attempt + 1))
                } catch (_: InterruptedException) {
                    return
                }
            }
        }
    }

    fun runInBackground(block: () -> Unit) = io.execute(block)

    // ------------------------------------------------------------------ SIM helpers

    /** Maps SIM slot (0/1) to a subscription id; -1 = use the phone's default SIM. */
    private fun subIdForSlot(context: Context, slot: Int): Int {
        if (slot < 0) return -1
        return try {
            when {
                Build.VERSION.SDK_INT >= 34 -> SubscriptionManager.getSubscriptionId(slot)
                Build.VERSION.SDK_INT >= 29 -> {
                    @Suppress("DEPRECATION")
                    context.getSystemService(SubscriptionManager::class.java)?.getSubscriptionIds(slot)?.firstOrNull() ?: -1
                }
                else -> -1
            }
        } catch (e: RuntimeException) {
            -1
        }
    }

    fun smsManager(context: Context, subId: Int): SmsManager {
        val sub = if (subId >= 0) subId else SubscriptionManager.getDefaultSmsSubscriptionId()
        val valid = sub >= 0 && sub != Int.MAX_VALUE
        return if (Build.VERSION.SDK_INT >= 31) {
            val base = context.getSystemService(SmsManager::class.java)
            if (valid) base.createForSubscriptionId(sub) else base
        } else {
            @Suppress("DEPRECATION")
            if (valid) SmsManager.getSmsManagerForSubscriptionId(sub) else SmsManager.getDefault()
        }
    }
}

/** Receives the radio's "sent" result for each part of a remotely requested SMS. Not exported. */
class SmsSentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val ok = resultCode == Activity.RESULT_OK
        val reason = when (resultCode) {
            Activity.RESULT_OK -> "已发出"
            SmsManager.RESULT_ERROR_RADIO_OFF -> "发送端处于飞行模式或无线已关闭"
            SmsManager.RESULT_ERROR_NO_SERVICE -> "发送端没有信号"
            SmsManager.RESULT_ERROR_NULL_PDU -> "短信编码失败"
            else -> "运营商拒绝或发送失败（错误码 $resultCode）"
        }
        val pending = goAsync()
        RemoteSms.runInBackground {
            try {
                val final = Db.get(context).recordRemotePart(id, ok)
                if (final != null) RemoteSms.finish(context, id, final, if (final) "已通过发送端手机发出" else if (ok) "部分内容发送失败" else reason)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_ID = "id"
    }
}
