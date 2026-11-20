package com.smsrelay.secure.receive

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import com.smsrelay.secure.Notifier
import com.smsrelay.secure.core.DeliveryException
import com.smsrelay.secure.core.E2E
import com.smsrelay.secure.core.E2EKeys
import com.smsrelay.secure.core.Ntfy
import com.smsrelay.secure.core.Payload
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.data.Settings
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection

/** Live connection state, shown on the receiver page. */
object RxStatus {
    @Volatile var state: String = "未启动"
    @Volatile var detail: String = ""
    @Volatile var lastMessageAt: Long = 0
}

/**
 * Keeps a streaming connection to the relay open and decrypts what arrives. Reconnects with
 * back-off, and on reconnect asks the relay for everything since the last message it saw,
 * so nothing is missed while the phone was offline (the relay keeps messages ~12 hours).
 */
class ReceiverLoop(private val context: Context) {
    @Volatile private var running = false
    private var thread: Thread? = null
    private val conn = AtomicReference<HttpsURLConnection?>()
    private val wake = Object()
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        if (running) return
        running = true
        registerNetworkCallback()
        thread = Thread({ loop() }, "relay-receiver").apply { isDaemon = true; start() }
    }

    fun stop() {
        running = false
        unregisterNetworkCallback()
        conn.getAndSet(null)?.let { c -> Thread { c.disconnect() }.start() }
        synchronized(wake) { wake.notifyAll() }
        thread?.interrupt()
        thread = null
        RxStatus.state = "已停止"
        RxStatus.detail = ""
    }

    val isRunning get() = running

    private fun loop() {
        var backoff = 2_000L
        while (running) {
            val s = Settings(context)
            val code = s.rxCode
            val keys = try {
                E2E.derive(code)
            } catch (e: IllegalArgumentException) {
                RxStatus.state = "配对码无效"
                running = false
                return
            }
            val server = s.rxServer
            val token = s.rxToken
            // Start from "now" the first time, and remember it, so a failed first connection
            // does not skip messages sent in the meantime.
            val since = s.rxSince.ifEmpty { (System.currentTimeMillis() / 1000).toString().also { s.rxSince = it } }
            RxStatus.state = "正在连接…"
            RxStatus.detail = Ntfy.base(server)
            try {
                Ntfy.subscribe(
                    server, keys.topic, token, since,
                    onConnection = { conn.set(it) },
                    onOpen = {
                        RxStatus.state = "已连接，等待短信"
                        RxStatus.detail = Ntfy.base(server)
                        backoff = 2_000L
                    },
                    onMessage = { ev ->
                        handle(keys, ev.message)
                        if (ev.id.isNotEmpty()) s.rxSince = ev.id
                    },
                    isCancelled = { !running },
                )
                if (!running) break
                RxStatus.state = "连接中断，正在重连…"
            } catch (e: DeliveryException) {
                RxStatus.state = "连接失败，稍后重试"
                RxStatus.detail = e.message ?: ""
                if (e.permanent) backoff = maxOf(backoff, 60_000L)
            } catch (e: Exception) {
                RxStatus.state = "连接失败，稍后重试"
                RxStatus.detail = e.message ?: e.javaClass.simpleName
            } finally {
                conn.set(null)
            }
            if (!running) break
            synchronized(wake) {
                try {
                    wake.wait(backoff)
                } catch (_: InterruptedException) {
                }
            }
            backoff = minOf(backoff * 2, 5 * 60_000L)
        }
    }

    private fun handle(keys: E2EKeys, message: String) {
        val plain = E2E.open(keys, message) ?: return // not ours or tampered with: drop silently
        val part = Payload.decode(String(plain, Charsets.UTF_8)) ?: return
        val db = Db.get(context)
        if (db.hasInbox(part.uid)) return
        val sms = if (part.total == 1) {
            Sms(part.uid, part.sender, part.body, part.time, part.sim, part.device)
        } else {
            db.addPart(part.uid, part.index, part.total, part.sender, part.body, part.time, part.device, part.sim) ?: return
        }
        if (db.addInbox(sms)) {
            RxStatus.lastMessageAt = System.currentTimeMillis()
            Notifier.received(context, sms)
        }
    }

    /** When the phone switches networks, drop the stale connection and reconnect right away. */
    private fun registerNetworkCallback() {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            private var current: Network? = null
            override fun onAvailable(network: Network) {
                if (current != null && current != network) {
                    conn.getAndSet(null)?.let { c -> Thread { c.disconnect() }.start() }
                }
                current = network
                synchronized(wake) { wake.notifyAll() }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            callback = cb
        } catch (_: RuntimeException) {
        }
    }

    private fun unregisterNetworkCallback() {
        val cb = callback ?: return
        callback = null
        try {
            context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb)
        } catch (_: RuntimeException) {
        }
    }
}
