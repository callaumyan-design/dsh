package com.smsrelay.secure.core

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Pairing codes connect a sending phone with one or more receiving phones.
 *
 * A code is 24 characters of Crockford base32 (no I, L, O, U), shown as six groups of four:
 *   23 random characters = 115 bits of entropy from SecureRandom
 *   + 1 check character, so a typo is detected immediately instead of failing silently.
 *
 * Everything needed for the encrypted channel (relay topic and AES key) is derived from the code,
 * so the code itself is the only secret and it never leaves the two phones.
 */
object Pairing {
    const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val DATA_LEN = 23
    const val CODE_LEN = DATA_LEN + 1

    fun generate(random: SecureRandom = SecureRandom()): String {
        val sb = StringBuilder(CODE_LEN)
        repeat(DATA_LEN) { sb.append(ALPHABET[random.nextInt(ALPHABET.length)]) }
        sb.append(checkChar(sb.toString()))
        return format(sb.toString())
    }

    /** "ABCD-EFGH-..." for display. */
    fun format(raw: String): String = raw.chunked(4).joinToString("-")

    /**
     * Returns the canonical 24-character code, or null if the input is not a valid code.
     * Accepts lower case, spaces and dashes, and the usual look-alikes (O→0, I/L→1).
     */
    fun normalize(input: String): String? {
        val sb = StringBuilder(CODE_LEN)
        for (c in input.uppercase()) {
            when {
                c == '-' || c.isWhitespace() -> continue
                c == 'O' -> sb.append('0')
                c == 'I' || c == 'L' -> sb.append('1')
                ALPHABET.indexOf(c) >= 0 -> sb.append(c)
                else -> return null
            }
        }
        if (sb.length != CODE_LEN) return null
        val raw = sb.toString()
        if (checkChar(raw.substring(0, DATA_LEN)) != raw[DATA_LEN]) return null
        return raw
    }

    private fun checkChar(data: String): Char {
        val h = MessageDigest.getInstance("SHA-256").digest("smsrelay-check:$data".toByteArray(Charsets.US_ASCII))
        // 256 is a multiple of 32, so this is uniform.
        return ALPHABET[(h[0].toInt() and 0xff) % ALPHABET.length]
    }
}
