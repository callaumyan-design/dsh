package com.smsrelay.secure.forward

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.PowerManager
import com.smsrelay.secure.Notifier
import com.smsrelay.secure.core.DeliveryException
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.data.Settings
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * The sending engine. Incoming SMS are first written to the local outbox, then delivered on
 * every enabled channel in parallel. Failures are retried with exponential back-off for about
 * a day (and survive reboots), so a message is not lost when the network is temporarily down.
 */
object Forwarder {
    private const val JOB_ID = 4201
    private const val MAX_ATTEMPTS = 10
    private val BACKOFF_SECONDS = longArrayOf(30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, 28800)

    private val runner = Executors.newSingleThreadExecutor()
    private val workers = Executors.newFixedThreadPool(4)

    fun enqueue(context: Context, sms: Sms): Boolean {
        val channels = Settings(context).enabledChannelIds()
        if (channels.isEmpty()) return false
        Db.get(context).enqueue(sms, channels)
        return true
    }

    /** Processes everything that is due, on a background thread. */
    fun kick(context: Context, onDone: (() -> Unit)? = null) {
        val app = context.applicationContext
        runner.execute {
            try {
                runOnce(app)
            } finally {
                onDone?.invoke()
            }
        }
    }

    private fun runOnce(context: Context) {
        val pm = context.getSystemService(PowerManager::class.java)
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SmsRelay:forward")
        wl.acquire(3 * 60_000L)
        try {
            val db = Db.get(context)
            val settings = Settings(context)
            val due = db.due(System.currentTimeMillis())
            val futures = ArrayList<Future<*>>()
            for (d in due) futures += workers.submit { attempt(context, db, settings, d) }
            for (f in futures) {
                try {
                    f.get(120, TimeUnit.SECONDS)
                } catch (_: Exception) {
                }
            }
        } finally {
            schedule(context)
            if (wl.isHeld) wl.release()
        }
    }

    private fun attempt(context: Context, db: Db, settings: Settings, d: Db.Delivery) {
        val sms = db.sms(d.msgId) ?: run {
            db.updateDelivery(d.id, Db.CANCELLED, d.attempts, 0, "原消息已删除")
            return
        }
        if (d.channel !in settings.enabledChannelIds()) {
            db.updateDelivery(d.id, Db.CANCELLED, d.attempts, 0, "通道已关闭")
            return
        }
        val attempts = d.attempts + 1
        try {
            Channels.send(context, settings, d.channel, sms)
            db.updateDelivery(d.id, Db.SENT, attempts, 0, null)
        } catch (e: Exception) {
            val msg = (e as? DeliveryException)?.message ?: "出错：${e.message ?: e.javaClass.simpleName}"
            val permanent = (e as? DeliveryException)?.permanent == true
            if (permanent || attempts >= MAX_ATTEMPTS) {
                db.updateDelivery(d.id, Db.FAILED, attempts, 0, msg)
                Notifier.deliveryFailed(context, Settings.channelName(d.channel), sms.sender, msg)
            } else {
                val delay = BACKOFF_SECONDS[minOf(attempts - 1, BACKOFF_SECONDS.size - 1)] * 1000
                db.updateDelivery(d.id, Db.PENDING, attempts, System.currentTimeMillis() + delay, msg)
            }
        }
    }

    /** Schedules a job for the next pending retry (or cancels it if nothing is pending). */
    fun schedule(context: Context) {
        val js = context.getSystemService(JobScheduler::class.java)
        val next = Db.get(context).nextDue()
        if (next == null) {
            js.cancel(JOB_ID)
            return
        }
        val delay = (next - System.currentTimeMillis()).coerceAtLeast(5_000)
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, RetryJobService::class.java))
            .setMinimumLatency(delay)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build()
        try {
            js.schedule(job)
        } catch (_: RuntimeException) {
        }
    }

    /** Sends a test message on a single channel, synchronously. Returns null on success. */
    fun test(context: Context, channel: String): String? = try {
        val s = Settings(context)
        Channels.send(context, s, channel, Sms.test(s.deviceLabel))
        null
    } catch (e: DeliveryException) {
        e.message
    } catch (e: Exception) {
        "出错：${e.message ?: e.javaClass.simpleName}"
    }
}

class RetryJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Forwarder.kick(this) { jobFinished(params, false) }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
