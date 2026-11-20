package com.smsrelay.secure.core

import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Keys derived from a pairing code. */
class E2EKeys(val topic: String, internal val key: ByteArray)

/**
 * End-to-end encryption between the sending and the receiving phone.
 *
 *  - Key derivation: HKDF-SHA256 over the pairing code (RFC 5869).
 *  - Cipher: AES-256-GCM, fresh 96-bit random nonce per message, 128-bit tag.
 *  - The relay topic is bound into the ciphertext as associated data.
 *
 * The relay server only ever sees "SR1." followed by random-looking base64. It cannot read,
 * alter or forge messages; anything that fails authentication is dropped by the receiver.
 */
object E2E {
    private const val PREFIX = "SR1."
    private const val NONCE_LEN = 12
    private const val TAG_BITS = 128

    fun derive(code: String): E2EKeys {
        val raw = Pairing.normalize(code) ?: throw IllegalArgumentException("配对码无效")
        val prk = hmac("smsrelay/v1".toByteArray(), raw.toByteArray(Charsets.US_ASCII))
        val topic = expand(prk, "relay topic", 16)
        val key = expand(prk, "aes-256-gcm key", 32)
        return E2EKeys("sr_" + topic.toHex(), key)
    }

    fun seal(keys: E2EKeys, plaintext: ByteArray, random: SecureRandom = SecureRandom()): String {
        val nonce = ByteArray(NONCE_LEN).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keys.key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(keys.topic.toByteArray(Charsets.US_ASCII))
        val ct = cipher.doFinal(plaintext)
        return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(nonce + ct)
    }

    /** Returns the plaintext, or null if the message is not ours or fails authentication. */
    fun open(keys: E2EKeys, message: String): ByteArray? {
        val m = message.trim()
        if (!m.startsWith(PREFIX)) return null
        val data = try {
            Base64.getUrlDecoder().decode(m.substring(PREFIX.length))
        } catch (e: IllegalArgumentException) {
            return null
        }
        if (data.size < NONCE_LEN + TAG_BITS / 8) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(keys.key, "AES"),
                GCMParameterSpec(TAG_BITS, data, 0, NONCE_LEN),
            )
            cipher.updateAAD(keys.topic.toByteArray(Charsets.US_ASCII))
            cipher.doFinal(data, NONCE_LEN, data.size - NONCE_LEN)
        } catch (e: GeneralSecurityException) {
            null
        }
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    /** HKDF-Expand for outputs up to one hash length (32 bytes). */
    private fun expand(prk: ByteArray, info: String, len: Int): ByteArray {
        require(len <= 32)
        val t = hmac(prk, info.toByteArray(Charsets.US_ASCII) + byteArrayOf(1))
        return t.copyOf(len)
    }
}

internal fun ByteArray.toHex(): String {
    val hex = "0123456789abcdef"
    val sb = StringBuilder(size * 2)
    for (b in this) {
        val v = b.toInt() and 0xff
        sb.append(hex[v ushr 4]).append(hex[v and 0x0f])
    }
    return sb.toString()
}
