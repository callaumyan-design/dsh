package com.smsrelay.secure.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTest {
    private val now = 1_800_000_000_000L
    private fun cmd(time: Long = now, to: String = "+86 138-0013-8000", body: String = "你好") =
        Remote.Command("c1", time, to, body, 1, "备用机")

    @Test
    fun commandRoundTrip() {
        val c = cmd()
        val json = Remote.encodeCommand(c)
        assertEquals(c, Remote.decodeCommand(json))
        assertEquals("cmd", Remote.type(json))
        // A command is never mistaken for a forwarded SMS and vice versa.
        assertNull(Payload.decode(json))
        val smsJson = Payload.encode(Sms("u", "1", "b", 0, null, "d"))[0]
        assertNull(Remote.decodeCommand(smsJson))
        assertEquals("sms", Remote.type(smsJson))
    }

    @Test
    fun resultRoundTrip() {
        val r = Remote.Result("c1", Remote.SENT, "ok", now)
        val json = Remote.encodeResult(r)
        assertEquals(r, Remote.decodeResult(json))
        assertNull(Remote.decodeResult(json.replace("\"sent\"", "\"pwned\"")))
    }

    @Test
    fun legacyUntypedSmsPayloadStillDecodes() {
        val legacy = "{\"v\":1,\"id\":\"u\",\"from\":\"95588\",\"body\":\"x\",\"ts\":1,\"sim\":\"\",\"dev\":\"d\",\"p\":0,\"n\":1}"
        assertNotNull(Payload.decode(legacy))
        assertEquals("sms", Remote.type(legacy))
    }

    @Test
    fun commandChannelIsSeparateFromSmsChannel() {
        val code = Pairing.generate()
        val sms = E2E.derive(code)
        val command = E2E.deriveCommand(code)
        assertNotEquals(sms.topic, command.topic)
        // An envelope sealed for one channel cannot be opened on the other.
        val sealed = E2E.seal(sms, Remote.encodeCommand(cmd()).toByteArray())
        assertNull(E2E.open(command, sealed))
        assertNotNull(E2E.open(sms, sealed))
        assertNotNull(E2E.open(command, E2E.seal(command, "x".toByteArray())))
    }

    @Test
    fun freshnessWindow() {
        assertNull(Remote.validate(cmd(time = now - 9 * 60_000), now))
        assertNull(Remote.validate(cmd(time = now + 9 * 60_000), now))
        assertTrue(Remote.validate(cmd(time = now - 11 * 60_000), now)!!.contains("过期"))
        assertTrue(Remote.validate(cmd(time = now + 11 * 60_000), now)!!.contains("过期"))
    }

    @Test
    fun contentValidation() {
        assertEquals("+8613800138000", Remote.normalizeNumber("+86 138-0013-8000"))
        assertEquals("10086", Remote.normalizeNumber(" 10086 "))
        assertNull(Remote.normalizeNumber("12"))
        assertNull(Remote.normalizeNumber("abc12345"))
        assertNull(Remote.normalizeNumber("+86 138*0013"))
        assertNotNull(Remote.validate(cmd(body = "  "), now))
        assertNotNull(Remote.validate(cmd(body = "长".repeat(700)), now))
        assertNull(Remote.validate(cmd(body = "长".repeat(600)), now))
    }

    @Test
    fun longestAllowedCommandFitsTheRelayLimit() {
        val keys = E2E.deriveCommand(Pairing.generate())
        val body = "长".repeat(Remote.MAX_BODY_BYTES / 3)
        assertNull(Remote.validateContent("13800138000", body))
        val sealed = E2E.seal(keys, Remote.encodeCommand(cmd(body = body)).toByteArray())
        assertTrue("envelope ${sealed.length}", sealed.toByteArray().size < 4096)
    }
}
