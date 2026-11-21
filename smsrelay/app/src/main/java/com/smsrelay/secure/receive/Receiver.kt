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
import com.smsrelay.secure.core.Remote
import com.smsrelay.secure.core.Sms
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.data.Settings
import com.smsrelay.secure.remote.RemoteSms
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection

/** Live connection state of one relay subscription, shown in the UI. */
class LoopStatus {
    @Volatile var state: String = "未启动"
    @Volatile var detail: String = ""
    @Volatile var lastMessageAt: Long = 0
    val connected: Boolean get() = state.startsWith("已连接")
}

/** Receiving phone: forwarded SMS (and remote-SMS results) from the sending phone. */
val RxStatus = LoopStatus()

/** Sending phone: remote-SMS commands from receiving phones. */
val CmdStatus = LoopStatus()

/**
 * Keeps a streaming connection to the relay open and decrypts what arrives. Reconnects with
 * back-off, and on reconnect asks the relay for everything since the last message it saw,
 * so nothing is missed while the phone was offline (the relay keeps messages ~12 hours).
 */
class RelayLoop(
    private val context: Context,
    private val name: String,
    private val status: LoopStatus,
    private val connectedText: String,
    private val config: (Settings) -> Config?,
    private val onMessage: (E2EKeys, String) -> Unit,
) {
    class Config(val keys: E2EKeys, val server: String, val token: String, val since: () -> String, val saveSince: (String) -> Unit)

    @Volatile private var running = false
    private var thread: Thread? = null
    private val conn = AtomicReference<HttpsURLConnection?>()
    private val wake = Object()
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        if (running) return
        running = true
        registerNetworkCallback()
        thread = Thread({ loop() }, name).apply { isDaemon = true; start() }
    }

    fun stop() {
        running = false
        unregisterNetworkCallback()
        conn.getAndSet(null)?.let { c -> Thread { c.disconnect() }.start() }
        synchronized(wake) { wake.notifyAll() }
        thread?.interrupt()
        thread = null
        status.state = "已停止"
        status.detail = ""
    }

    val isRunning get() = running

    private fun loop() {
        var backoff = 2_000L
        while (running) {
            val cfg = try {
                config(Settings(context))
            } catch (e: IllegalArgumentException) {
                null
            }
            if (cfg == null) {
                status.state = "配对码无效"
                running = false
                return
            }
            val since = cfg.since()
            status.state = "正在连接…"
            status.detail = Ntfy.base(cfg.server)
            try {
                Ntfy.subscribe(
                    cfg.server, cfg.keys.topic, cfg.token, since,
                    onConnection = { conn.set(it) },
                    onOpen = {
                        status.state = connectedText
                        status.detail = Ntfy.base(cfg.server)
                        backoff = 2_000L
                    },
                    onMessage = { ev ->
                        try {
                            onMessage(cfg.keys, ev.message)
                        } catch (_: RuntimeException) {
                            // A bad message must never take the connection down.
                        }
                        if (ev.id.isNotEmpty()) cfg.saveSince(ev.id)
                    },
                    isCancelled = { !running },
                )
                if (!running) break
                status.state = "连接中断，正在重连…"
            } catch (e: DeliveryException) {
                status.state = "连接失败，稍后重试"
                status.detail = e.message ?: ""
                if (e.permanent) backoff = maxOf(backoff, 60_000L)
            } catch (e: Exception) {
                status.state = "连接失败，稍后重试"
                status.detail = e.message ?: e.javaClass.simpleName
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

    companion object {
        /** Start from "now" the first time, and remember it, so a failed first connection does not skip messages. */
        private fun sinceOrNow(current: String, save: (String) -> Unit): String =
            current.ifEmpty { (System.currentTimeMillis() / 1000).toString().also(save) }

        /** Receiving phone: forwarded SMS and remote-SMS results. */
        fun receiver(context: Context) = RelayLoop(
            context, "relay-receiver", RxStatus, "已连接，等待短信",
            config = { s ->
                Config(E2E.derive(s.rxCode), s.rxServer, s.rxToken, { sinceOrNow(s.rxSince) { s.rxSince = it } }, { s.rxSince = it })
            },
            onMessage = { keys, message -> handleReceived(context, keys, message) },
        )

        /** Sending phone: remote-SMS commands. */
        fun commands(context: Context) = RelayLoop(
            context, "relay-commands", CmdStatus, "已连接，可接受远程发短信",
            config = { s ->
                Config(E2E.deriveCommand(s.e2eCode), s.e2eServer, s.e2eToken, { sinceOrNow(s.cmdSince) { s.cmdSince = it } }, { s.cmdSince = it })
            },
            onMessage = { keys, message ->
                val plain = E2E.open(keys, message)
                val cmd = plain?.let { Remote.decodeCommand(String(it, Charsets.UTF_8)) }
                if (cmd != null) RemoteSms.execute(context, cmd)
            },
        )

        private fun handleReceived(context: Context, keys: E2EKeys, message: String) {
            val plain = E2E.open(keys, message) ?: return // not ours or tampered with: drop silently
            val json = String(plain, Charsets.UTF_8)
            when (Remote.type(json)) {
                "sms" -> {
                    val part = Payload.decode(json) ?: return
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
                "result" -> Remote.decodeResult(json)?.let { RemoteSms.onResult(context, it) }
            }
        }
    }
}
