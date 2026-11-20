package com.smsrelay.secure.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PayloadTest {
    private fun sms(body: String) = Sms("uid-1", "+8613800138000", body, 1_700_000_000_000, "卡1", "测试机")

    @Test
    fun shortMessageIsOnePart() {
        val parts = Payload.encode(sms("你好"))
        assertEquals(1, parts.size)
        val p = Payload.decode(parts[0])!!
        assertEquals("你好", p.body)
        assertEquals("+8613800138000", p.sender)
        assertEquals("卡1", p.sim)
        assertEquals(0, p.index)
        assertEquals(1, p.total)
    }

    @Test
    fun longMessageIsSplitAndEveryEnvelopeFitsTheRelayLimit() {
        val body = buildString { repeat(3000) { append("长短信😀") } }
        val parts = Payload.encode(sms(body))
        assertTrue(parts.size > 1)
        val keys = E2E.derive(Pairing.generate())
        val decoded = parts.map { json ->
            val sealed = E2E.seal(keys, json.toByteArray())
            assertTrue("envelope ${sealed.length} bytes", sealed.toByteArray().size < 4096)
            Payload.decode(String(E2E.open(keys, sealed)!!))!!
        }
        assertEquals(body, decoded.sortedBy { it.index }.joinToString("") { it.body })
        assertTrue(decoded.all { it.total == parts.size })
    }

    @Test
    fun splitNeverBreaksCodePoints() {
        val text = "a😀b中😀c".repeat(50)
        for (max in 4..20) {
            val chunks = Payload.splitUtf8(text, max)
            assertEquals(text, chunks.joinToString(""))
            chunks.forEach { assertTrue(it.toByteArray().size <= max) }
        }
    }

    @Test
    fun malformedPayloadsAreRejected() {
        assertNull(Payload.decode("not json"))
        assertNull(Payload.decode("{\"v\":2,\"id\":\"x\",\"p\":0,\"n\":1}"))
        assertNull(Payload.decode("{\"v\":1,\"id\":\"x\",\"p\":3,\"n\":2}"))
        assertNull(Payload.decode("{\"v\":1,\"id\":\"\",\"p\":0,\"n\":1}"))
    }
}
