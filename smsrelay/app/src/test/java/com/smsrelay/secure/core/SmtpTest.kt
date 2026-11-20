package com.smsrelay.secure.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.util.Base64
import kotlin.concurrent.thread

class SmtpTest {
    /** A scripted fake SMTP server; records what the client sent. */
    private fun fakeServer(authOk: Boolean, mechanisms: String = "PLAIN LOGIN"): Pair<Int, MutableList<String>> {
        val server = ServerSocket(0)
        val log = java.util.Collections.synchronizedList(mutableListOf<String>())
        thread(isDaemon = true) {
            server.use { ss ->
                val s = ss.accept()
                s.use {
                    val r = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
                    val w = s.getOutputStream()
                    fun say(x: String) { w.write((x + "\r\n").toByteArray()); w.flush() }
                    say("220 fake ESMTP")
                    var inData = false
                    while (true) {
                        val line = r.readLine() ?: break
                        log.add(line)
                        if (inData) {
                            if (line == ".") { inData = false; say("250 queued") }
                            continue
                        }
                        when {
                            line.startsWith("EHLO") -> { say("250-fake"); say("250-STARTTLS"); say("250 AUTH $mechanisms") }
                            line.startsWith("STARTTLS") -> say("220 go ahead")
                            line.startsWith("AUTH PLAIN") -> say(if (authOk) "235 ok" else "535 bad credentials")
                            line == "AUTH LOGIN" -> say("334 VXNlcm5hbWU6")
                            line.startsWith("MAIL FROM") -> say("250 ok")
                            line.startsWith("RCPT TO") -> say("250 ok")
                            line == "DATA" -> { inData = true; say("354 go") }
                            line == "QUIT" -> { say("221 bye"); break }
                            log.size >= 2 && log[log.size - 2] == "AUTH LOGIN" -> say("334 UGFzc3dvcmQ6")
                            else -> say(if (authOk) "235 ok" else "535 bad")
                        }
                    }
                }
            }
        }
        return server.localPort to log
    }

    private fun cfg(port: Int, startTls: Boolean = false) =
        SmtpConfig("127.0.0.1", port, startTls, "me@example.com", "app-password", "me@example.com", listOf("you@example.com", "other@example.com"))

    @Test
    fun sendsMailWithAuthPlain() {
        val (port, log) = fakeServer(authOk = true)
        SmtpClient(insecurePlaintextForTests = true, timeoutMs = 5000).send(cfg(port, startTls = true), "短信 95588: 验证码", "第一行\n第二行")
        val auth = log.first { it.startsWith("AUTH PLAIN") }.removePrefix("AUTH PLAIN ")
        assertEquals("\u0000me@example.com\u0000app-password", String(Base64.getDecoder().decode(auth)))
        assertTrue(log.contains("STARTTLS"))
        assertTrue(log.contains("RCPT TO:<you@example.com>"))
        assertTrue(log.contains("RCPT TO:<other@example.com>"))
        val bodyB64 = log.dropWhile { it.isNotEmpty() }.drop(1).takeWhile { it != "." }.joinToString("")
        assertEquals("第一行\r\n第二行", String(Base64.getDecoder().decode(bodyB64)))
        assertTrue(log.any { it.startsWith("Subject: =?UTF-8?B?") })
    }

    @Test
    fun usesAuthLoginWhenPlainIsUnavailable() {
        val (port, log) = fakeServer(authOk = true, mechanisms = "LOGIN")
        SmtpClient(insecurePlaintextForTests = true, timeoutMs = 5000).send(cfg(port), "s", "t")
        assertTrue(log.contains("AUTH LOGIN"))
        assertTrue(log.contains(Base64.getEncoder().encodeToString("me@example.com".toByteArray())))
    }

    @Test
    fun wrongPasswordIsAPermanentFailure() {
        val (port, _) = fakeServer(authOk = false)
        try {
            SmtpClient(insecurePlaintextForTests = true, timeoutMs = 5000).send(cfg(port), "s", "t")
            fail("expected failure")
        } catch (e: DeliveryException) {
            assertTrue(e.permanent)
            assertTrue(e.message!!.contains("授权码"))
        }
    }

    @Test
    fun headerInjectionIsRejected() {
        try {
            SmtpClient(insecurePlaintextForTests = true).send(
                SmtpConfig("127.0.0.1", 25, false, "a@b.c", "p", "a@b.c", listOf("x@y.z\r\nBcc: evil@z.z")), "s", "t",
            )
            fail("expected failure")
        } catch (e: DeliveryException) {
            assertTrue(e.permanent)
        }
    }

    @Test
    fun subjectEncodingRoundTrips() {
        val subject = "短信 +8613800138000: 您的验证码是 123456，请勿泄露给他人😀"
        val enc = SmtpClient.encodeHeader(subject)
        val decoded = enc.split("\r\n ").joinToString("") {
            String(Base64.getDecoder().decode(it.removePrefix("=?UTF-8?B?").removeSuffix("?=")), Charsets.UTF_8)
        }
        assertEquals(subject, decoded)
        enc.split("\r\n ").forEach { assertTrue(it.length <= 75) }
    }
}
