package com.smsrelay.secure.core

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale
import java.util.UUID
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

data class SmtpConfig(
    val host: String,
    val port: Int,
    val startTls: Boolean,
    val username: String,
    val password: String,
    val from: String,
    val to: List<String>,
)

/**
 * A small, dependency-free SMTP client that only ever talks over TLS:
 *  - implicit TLS ("SSL", usually port 465), or
 *  - STARTTLS (usually port 587). The upgrade is mandatory; we never authenticate in plaintext.
 * Certificates are validated by the platform trust store and the hostname is verified explicitly.
 */
class SmtpClient(
    private val sslFactory: SSLSocketFactory = SSLSocketFactory.getDefault() as SSLSocketFactory,
    private val hostnameVerifier: HostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier(),
    private val timeoutMs: Int = 20_000,
    private val insecurePlaintextForTests: Boolean = false,
) {
    private lateinit var socket: Socket
    private lateinit var input: InputStream
    private lateinit var output: OutputStream

    fun send(cfg: SmtpConfig, subject: String, text: String) {
        validate(cfg)
        try {
            val plain = Socket()
            plain.soTimeout = timeoutMs
            plain.connect(InetSocketAddress(cfg.host, cfg.port), timeoutMs)
            socket = plain
            if (!cfg.startTls) upgrade(cfg.host)
            bind()
            try {
                expect(reply(), 220)
                var caps = ehlo()
                if (cfg.startTls) {
                    if (!insecurePlaintextForTests && caps.none { it.uppercase().startsWith("STARTTLS") }) {
                        throw DeliveryException("邮件服务器不支持 STARTTLS 加密，已拒绝发送", permanent = true)
                    }
                    command("STARTTLS")
                    expect(reply(), 220)
                    upgrade(cfg.host)
                    bind()
                    caps = ehlo()
                }
                authenticate(caps, cfg.username, cfg.password)
                command("MAIL FROM:<${cfg.from}>")
                expect(reply(), 250)
                for (rcpt in cfg.to) {
                    command("RCPT TO:<$rcpt>")
                    val r = reply()
                    if (r.code != 250 && r.code != 251) {
                        throw DeliveryException("收件地址 $rcpt 被拒绝：${r.text}", permanent = r.code in 500..599)
                    }
                }
                command("DATA")
                expect(reply(), 354)
                output.write(buildMessage(cfg, subject, text))
                output.flush()
                expect(reply(), 250)
                try {
                    command("QUIT")
                } catch (_: IOException) {
                }
            } finally {
                try {
                    socket.close()
                } catch (_: IOException) {
                }
            }
        } catch (e: DeliveryException) {
            throw e
        } catch (e: UnknownHostException) {
            throw DeliveryException("找不到邮件服务器 ${cfg.host}", cause = e)
        } catch (e: SocketTimeoutException) {
            throw DeliveryException("连接邮件服务器超时", cause = e)
        } catch (e: SSLException) {
            throw DeliveryException("与邮件服务器的安全连接失败（证书校验未通过）", cause = e)
        } catch (e: IOException) {
            throw DeliveryException("邮件发送网络错误：${e.message ?: e.javaClass.simpleName}", cause = e)
        }
    }

    private fun validate(cfg: SmtpConfig) {
        fun bad(s: String) = s.any { it == '\r' || it == '\n' || it == '<' || it == '>' }
        if (cfg.host.isBlank() || cfg.port !in 1..65535) throw DeliveryException("邮件服务器地址或端口不正确", true)
        if (cfg.to.isEmpty()) throw DeliveryException("没有填写收件邮箱", true)
        for (a in cfg.to + cfg.from) {
            if (bad(a) || !a.contains('@') || a.length > 254) throw DeliveryException("邮箱地址格式不正确：$a", true)
        }
        if (bad(cfg.username) || cfg.password.any { it == '\r' || it == '\n' }) {
            throw DeliveryException("用户名或密码包含非法字符", true)
        }
    }

    private fun upgrade(host: String) {
        if (insecurePlaintextForTests) return
        val ssl = sslFactory.createSocket(socket, host, socket.port, true) as SSLSocket
        val wanted = ssl.supportedProtocols.filter { it == "TLSv1.2" || it == "TLSv1.3" }
        if (wanted.isEmpty()) throw DeliveryException("系统不支持 TLS 1.2+", true)
        ssl.enabledProtocols = wanted.toTypedArray()
        ssl.soTimeout = timeoutMs
        ssl.startHandshake()
        if (!hostnameVerifier.verify(host, ssl.session)) {
            ssl.close()
            throw DeliveryException("邮件服务器证书与域名 $host 不匹配，已中止", permanent = true)
        }
        socket = ssl
    }

    private fun bind() {
        input = BufferedInputStream(socket.getInputStream())
        output = socket.getOutputStream()
    }

    private fun ehlo(): List<String> {
        command("EHLO smsrelay.local")
        val r = reply()
        expect(r, 250)
        return r.lines.drop(1)
    }

    private fun authenticate(caps: List<String>, user: String, pass: String) {
        val authLine = caps.firstOrNull { it.uppercase().startsWith("AUTH") }?.uppercase() ?: ""
        val mechanisms = authLine.removePrefix("AUTH").replace('=', ' ').split(' ').filter { it.isNotBlank() }
        val b64 = Base64.getEncoder()
        val r: Reply
        if ("PLAIN" in mechanisms || mechanisms.isEmpty()) {
            val token = b64.encodeToString("\u0000$user\u0000$pass".toByteArray(Charsets.UTF_8))
            command("AUTH PLAIN $token", sensitive = true)
            r = reply()
        } else if ("LOGIN" in mechanisms) {
            command("AUTH LOGIN")
            expect(reply(), 334)
            command(b64.encodeToString(user.toByteArray(Charsets.UTF_8)), sensitive = true)
            expect(reply(), 334)
            command(b64.encodeToString(pass.toByteArray(Charsets.UTF_8)), sensitive = true)
            r = reply()
        } else {
            throw DeliveryException("邮件服务器不支持的登录方式：$authLine", true)
        }
        if (r.code != 235) {
            val permanent = r.code in 500..599
            throw DeliveryException(
                if (r.code == 535 || r.code == 534 || r.code == 530) {
                    "邮箱登录失败：账号或授权码不正确（很多邮箱需要使用“授权码/应用专用密码”，而不是登录密码）"
                } else {
                    "邮箱登录失败：${r.code} ${r.text}"
                },
                permanent,
            )
        }
    }

    class Reply(val code: Int, val lines: List<String>) {
        val text: String get() = lines.joinToString(" ").take(200)
    }

    private fun command(line: String, @Suppress("UNUSED_PARAMETER") sensitive: Boolean = false) {
        output.write((line + "\r\n").toByteArray(Charsets.UTF_8))
        output.flush()
    }

    private fun readLine(): String {
        val buf = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) throw IOException("连接被服务器关闭")
            if (b == '\n'.code) break
            if (b != '\r'.code) buf.write(b)
            if (buf.size() > 4096) throw IOException("服务器响应过长")
        }
        return buf.toString("UTF-8")
    }

    private fun reply(): Reply {
        val lines = ArrayList<String>()
        var code: Int
        while (true) {
            val line = readLine()
            if (line.length < 3) throw IOException("无法识别的服务器响应")
            code = line.substring(0, 3).toIntOrNull() ?: throw IOException("无法识别的服务器响应")
            lines.add(if (line.length > 4) line.substring(4) else "")
            if (line.length == 3 || line[3] == ' ') break
            if (lines.size > 100) throw IOException("服务器响应过长")
        }
        return Reply(code, lines)
    }

    private fun expect(r: Reply, code: Int) {
        if (r.code != code) {
            throw DeliveryException("邮件服务器拒绝：${r.code} ${r.text}", permanent = r.code in 500..599)
        }
    }

    companion object {
        /** Builds the full DATA section, terminated by CRLF.CRLF. Visible for tests. */
        fun buildMessage(cfg: SmtpConfig, subject: String, text: String): ByteArray {
            val date = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US).format(Date())
            val domain = cfg.from.substringAfter('@', "smsrelay.local")
            val sb = StringBuilder()
            sb.append("Date: ").append(date).append("\r\n")
            sb.append("From: ").append(encodeWord("短信安全转发")).append(" <").append(cfg.from).append(">\r\n")
            sb.append("To: ").append(cfg.to.joinToString(", ")).append("\r\n")
            sb.append("Subject: ").append(encodeHeader(subject)).append("\r\n")
            sb.append("Message-ID: <").append(UUID.randomUUID()).append('@').append(domain).append(">\r\n")
            sb.append("MIME-Version: 1.0\r\n")
            sb.append("Content-Type: text/plain; charset=UTF-8\r\n")
            sb.append("Content-Transfer-Encoding: base64\r\n")
            sb.append("\r\n")
            val body = Base64.getEncoder().encodeToString(text.replace("\n", "\r\n").toByteArray(Charsets.UTF_8))
            body.chunked(76).forEach { sb.append(it).append("\r\n") }
            // Base64 lines never start with '.', so no dot-stuffing is needed.
            sb.append(".\r\n")
            return sb.toString().toByteArray(Charsets.UTF_8)
        }

        private fun encodeWord(s: String) =
            "=?UTF-8?B?" + Base64.getEncoder().encodeToString(s.toByteArray(Charsets.UTF_8)) + "?="

        /** RFC 2047 encoding, split into encoded-words of at most ~45 bytes and folded. */
        fun encodeHeader(s: String): String {
            val clean = s.replace('\r', ' ').replace('\n', ' ')
            return Payload.splitUtf8(clean, 45).joinToString("\r\n ") { encodeWord(it) }
        }
    }
}
