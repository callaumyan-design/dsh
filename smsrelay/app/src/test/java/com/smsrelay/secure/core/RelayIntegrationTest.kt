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
}
