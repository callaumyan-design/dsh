package com.smsrelay.secure.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class CryptoTest {
    @Test
    fun pairingCodeRoundTrip() {
        repeat(200) {
            val code = Pairing.generate()
            assertEquals(29, code.length) // 24 chars + 5 dashes
            val raw = Pairing.normalize(code)
            assertNotNull(raw)
            assertEquals(code, Pairing.format(raw!!))
            // Lower case, spaces and missing dashes are accepted.
            assertEquals(raw, Pairing.normalize(code.lowercase().replace("-", " ")))
        }
    }

    @Test
    fun pairingCodeDetectsTypos() {
        var detected = 0
        val trials = 2000
        repeat(trials) {
            val raw = Pairing.normalize(Pairing.generate())!!
            val pos = it % raw.length
            val orig = raw[pos]
            val replacement = Pairing.ALPHABET.first { c -> c != orig }
            val typo = raw.substring(0, pos) + replacement + raw.substring(pos + 1)
            if (Pairing.normalize(typo) == null) detected++
        }
        // One check character catches ~31/32 of single-character typos.
        assertTrue("detected $detected/$trials", detected > trials * 0.9)
        assertNull(Pairing.normalize("ABCD"))
        assertNull(Pairing.normalize("UUUU-UUUU-UUUU-UUUU-UUUU-UUUU"))
    }

    @Test
    fun lookAlikesAreMapped() {
        val raw = Pairing.normalize(Pairing.generate())!!
        val withLookAlikes = raw.replace('0', 'O').replace('1', 'I')
        assertEquals(raw, Pairing.normalize(withLookAlikes))
    }

    @Test
    fun keyDerivationIsDeterministicAndSeparated() {
        val code = Pairing.generate()
        val a = E2E.derive(code)
        val b = E2E.derive(code.lowercase())
        assertEquals(a.topic, b.topic)
        assertArrayEquals(a.key, b.key)
        assertTrue(a.topic.matches(Regex("sr_[0-9a-f]{32}")))
        val other = E2E.derive(Pairing.generate())
        assertNotEquals(a.topic, other.topic)
        assertEquals(32, a.key.size)
    }

    @Test
    fun sealAndOpen() {
        val keys = E2E.derive(Pairing.generate())
        val msg = "验证码 123456，5分钟内有效。🔐".toByteArray()
        val sealed = E2E.seal(keys, msg)
        assertTrue(sealed.startsWith("SR1."))
        assertArrayEquals(msg, E2E.open(keys, sealed))
        // Fresh nonce each time.
        assertNotEquals(sealed, E2E.seal(keys, msg))
        // The plaintext does not appear in the envelope.
        assertTrue(!sealed.contains("123456"))
    }

    @Test
    fun tamperedOrForeignMessagesAreRejected() {
        val keys = E2E.derive(Pairing.generate())
        val sealed = E2E.seal(keys, "hello".toByteArray())
        val raw = Base64.getUrlDecoder().decode(sealed.removePrefix("SR1."))
        for (i in raw.indices) {
            val t = raw.clone()
            t[i] = (t[i].toInt() xor 1).toByte()
            assertNull(E2E.open(keys, "SR1." + Base64.getUrlEncoder().withoutPadding().encodeToString(t)))
        }
        assertNull(E2E.open(E2E.derive(Pairing.generate()), sealed))
        assertNull(E2E.open(keys, "hello world"))
        assertNull(E2E.open(keys, "SR1.!!!"))
        assertNull(E2E.open(keys, "SR1.AAAA"))
    }

    @Test
    fun barkEncryptionMatchesOpenssl() {
        // Reference values produced with the openssl command line from Bark's encryption docs:
        //   printf '%s' "$json" | openssl enc -aes-128-cbc -K <hex key> -iv <hex iv> | base64
        assertEquals(
            "d3QhjQjP5majvNt5CjsvFWwqqj2gKl96RFj5OO+u6ynTt7lkyigDYNA3abnnCLpr",
            Bark.encrypt("{\"body\": \"test\", \"sound\": \"birdsong\"}", "1234567890123456", "1111111111111111"),
        )
        // AES-256 (32-character key), as used by the app, with UTF-8 content.
        assertEquals(
            "v4BzI6SWvqsNfSy+scWLlSfClk+f13JIwG1npe+a9xA=",
            Bark.encrypt("{\"title\":\"t\",\"body\":\"中文\"}", "abcdefghjkmnpqrstuvwxyz234567892", "abcdefghjkmnpqrs"),
        )
        val key = typeableKey(32)
        assertEquals(32, key.length)
        assertTrue(key.all { it in "abcdefghjkmnpqrstuvwxyz23456789" })
    }
}
