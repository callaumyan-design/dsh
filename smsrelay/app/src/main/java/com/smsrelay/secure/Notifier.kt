package com.smsrelay.secure

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PersistableBundle
import android.widget.Toast
import com.smsrelay.secure.core.CodeExtractor
import com.smsrelay.secure.core.Formatter
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.data.Settings
import com.smsrelay.secure.ui.MainActivity

object Notifier {
    const val ID_SERVICE = 1
    private const val CH_SERVICE = "service"
    private const val CH_SMS = "received_sms"
    private const val CH_ALERT = "alerts"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_SMS, "收到的转发短信", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "接收端收到另一台手机转发来的短信"
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_ALERT, "转发失败提醒", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "某个通道多次重试仍然失败时提醒你"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "后台运行状态", NotificationManager.IMPORTANCE_MIN).apply {
                description = "保持转发/接收在后台运行所必需的常驻通知，可以在这里把它设为静默"
                setShowBadge(false)
            },
        )
    }

    private fun canNotify(context: Context) = Build.VERSION.SDK_INT < 33 ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openApp(context: Context, tab: Int): PendingIntent = PendingIntent.getActivity(
        context, tab,
        Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_TAB, tab)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun serviceNotification(context: Context, s: Settings): Notification {
        val parts = buildList {
            if (s.forwardEnabled && s.enabledChannelIds().isNotEmpty()) add("短信转发中")
            if (s.receiverConfigured()) add("正在接收加密短信")
        }
        return Notification.Builder(context, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(parts.joinToString(" · ").ifEmpty { "运行中" })
            .setOngoing(true)
            .setContentIntent(openApp(context, 0))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build()
    }

    fun received(context: Context, sms: Sms) {
        if (!canNotify(context)) return
        val code = CodeExtractor.extract(sms.body)
        val title = if (code != null) "验证码 $code · ${sms.sender}" else Formatter.title(sms)
        val text = sms.body
        val public = Notification.Builder(context, CH_SMS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("收到一条转发短信")
            .setContentText("解锁后查看内容")
            .build()
        val b = Notification.Builder(context, CH_SMS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text + "\n—— " + Formatter.footer(sms)))
            .setSubText(sms.device)
            .setWhen(sms.time)
            .setShowWhen(true)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(public)
            .setContentIntent(openApp(context, 2))
        if (code != null) {
            val copy = PendingIntent.getBroadcast(
                context, sms.uid.hashCode(),
                Intent(context, CopyCodeReceiver::class.java).putExtra(CopyCodeReceiver.EXTRA_CODE, code),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            b.addAction(Notification.Action.Builder(null, "复制验证码 $code", copy).build())
        }
        context.getSystemService(NotificationManager::class.java).notify(sms.uid.hashCode(), b.build())
    }

    fun deliveryFailed(context: Context, channel: String, sender: String, error: String) {
        if (!canNotify(context)) return
        val n = Notification.Builder(context, CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("转发失败：$channel")
            .setContentText(error)
            .setStyle(Notification.BigTextStyle().bigText("来自 $sender 的短信未能通过「$channel」转发。\n原因：$error"))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 0))
            .build()
        context.getSystemService(NotificationManager::class.java).notify(("fail$channel").hashCode(), n)
    }

    fun copySensitive(context: Context, label: String, text: String) {
        val cm = context.getSystemService(ClipboardManager::class.java)
        val clip = ClipData.newPlainText(label, text)
        if (Build.VERSION.SDK_INT >= 33) {
            clip.description.extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        cm.setPrimaryClip(clip)
    }
}

/** Handles the "copy code" button on a received-SMS notification. Not exported. */
class CopyCodeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val code = intent.getStringExtra(EXTRA_CODE) ?: return
        Notifier.copySensitive(context, "验证码", code)
        Toast.makeText(context, "已复制验证码 $code", Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val EXTRA_CODE = "code"
    }
}
