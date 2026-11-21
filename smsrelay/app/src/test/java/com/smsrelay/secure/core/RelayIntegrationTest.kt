package com.smsrelay.secure.core

import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection
import kotlin.concurrent.thread

/**
 * Real end-to-end test through the public ntfy.sh relay: subscribe like the receiving phone,
 * publish like the sending phone, decrypt. Run with: ./gradlew test -Dintegration=true
 */
class RelayIntegrationTest {
    @Test
    fun encryptedRoundTripThroughNtfy() {
        assumeTrue(System.getProperty("integration") == "true")
        val code = Pairing.generate()
        val keys = E2E.derive(code)
        val sms = Sms(Sms.newUid(), "+8613800138000", "集成测试：验证码 135790 " + "长".repeat(1500), System.currentTimeMillis(), "卡1", "CI")

        val opened = CountDownLatch(1)
        val done = CountDownLatch(1)
        val parts = java.util.Collections.synchronizedList(mutableListOf<Payload.Part>())
        val conn = AtomicReference<HttpsURLConnection>()
        val expected = Payload.encode(sms).size
        thread(isDaemon = true) {
            try {
                Ntfy.subscribe(
                    Ntfy.DEFAULT_SERVER, keys.topic, null, "all",
                    onConnection = { conn.set(it) },
                    onOpen = { opened.countDown() },
                    onMessage = { ev ->
                        val plain = E2E.open(keys, ev.message)
                        if (plain != null) {
                            parts += Payload.decode(String(plain))!!
                            if (parts.size == expected) done.countDown()
                        }
                    },
                    isCancelled = { done.count == 0L },
                )
            } catch (_: Exception) {
            }
        }
        assertEquals(true, opened.await(20, TimeUnit.SECONDS))
        for (p in Payload.encode(sms)) Ntfy.publish(Ntfy.DEFAULT_SERVER, keys.topic, null, E2E.seal(keys, p.toByteArray()))
        assertEquals(true, done.await(30, TimeUnit.SECONDS))
        conn.get()?.disconnect()
        assertEquals(sms.body, parts.sortedBy { it.index }.joinToString("") { it.body })
        println("Relay round trip OK: ${parts.size} encrypted parts via ${keys.topic.take(8)}…")
    }

    @Test
    fun remoteCommandAndResultThroughNtfy() {
        assumeTrue(System.getProperty("integration") == "true")
        val code = Pairing.generate()
        val cmdKeys = E2E.deriveCommand(code)
        val mainKeys = E2E.derive(code)
        val cmd = Remote.Command(Sms.newUid(), System.currentTimeMillis(), "+8613800138000", "远程测试 123", 0, "CI")

        // Executor side: listen for commands, validate, reply on the main channel.
        val executorOpen = CountDownLatch(1)
        val executed = AtomicReference<Remote.Command>()
        val c1 = AtomicReference<HttpsURLConnection>()
        thread(isDaemon = true) {
            try {
                Ntfy.subscribe(Ntfy.DEFAULT_SERVER, cmdKeys.topic, null, "all", { c1.set(it) }, { executorOpen.countDown() }, { ev ->
                    val got = E2E.open(cmdKeys, ev.message)?.let { Remote.decodeCommand(String(it)) }
                    if (got != null && Remote.validate(got, System.currentTimeMillis()) == null && executed.compareAndSet(null, got)) {
                        val r = Remote.encodeResult(Remote.Result(got.id, Remote.SENT, "ok", System.currentTimeMillis()))
                        Ntfy.publish(Ntfy.DEFAULT_SERVER, mainKeys.topic, null, E2E.seal(mainKeys, r.toByteArray()))
                    }
                }, { executed.get() != null })
            } catch (_: Exception) {
            }
        }
        // Controller side: listen for results on the main channel.
        val controllerOpen = CountDownLatch(1)
        val result = AtomicReference<Remote.Result>()
        val done = CountDownLatch(1)
        val c2 = AtomicReference<HttpsURLConnection>()
        thread(isDaemon = true) {
            try {
                Ntfy.subscribe(Ntfy.DEFAULT_SERVER, mainKeys.topic, null, "all", { c2.set(it) }, { controllerOpen.countDown() }, { ev ->
                    E2E.open(mainKeys, ev.message)?.let { Remote.decodeResult(String(it)) }?.let { result.set(it); done.countDown() }
                }, { done.count == 0L })
            } catch (_: Exception) {
            }
        }
        assertEquals(true, executorOpen.await(20, TimeUnit.SECONDS))
        assertEquals(true, controllerOpen.await(20, TimeUnit.SECONDS))
        Ntfy.publish(Ntfy.DEFAULT_SERVER, cmdKeys.topic, null, E2E.seal(cmdKeys, Remote.encodeCommand(cmd).toByteArray()))
        assertEquals(true, done.await(30, TimeUnit.SECONDS))
        c1.get()?.disconnect()
        c2.get()?.disconnect()
        assertEquals(cmd, executed.get())
        assertEquals(cmd.id, result.get().id)
        assertEquals(Remote.SENT, result.get().status)
        println("Remote command round trip OK via ${cmdKeys.topic.take(8)}… and ${mainKeys.topic.take(8)}…")
    }
}
