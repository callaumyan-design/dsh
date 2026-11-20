package com.smsrelay.secure.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.URLDecoder
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class WebhookTest {
    private val sms = Sms("u", "95588", "验证码 1234", 1_700_000_000_000, null, "主力机")

    @Test
    fun wecomBody() {
        val (url, json) = Webhook.build(Webhook.WECOM, "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k", null, sms, "TEXT", 0)
        assertEquals("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k", url)
        val o = JSONObject(json)
        assertEquals("text", o.getString("msgtype"))
        assertEquals("TEXT", o.getJSONObject("text").getString("content"))
    }

    @Test
    fun dingtalkSignature() {
        val now = 1_700_000_000_123L
        val (url, _) = Webhook.build(Webhook.DINGTALK, "https://oapi.dingtalk.com/robot/send?access_token=t", "SECabc", sms, "T", now)
        assertTrue(url.contains("&timestamp=$now&sign="))
        val sign = URLDecoder.decode(url.substringAfter("sign="), "UTF-8")
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec("SECabc".toByteArray(), "HmacSHA256")) }
        assertEquals(Base64.getEncoder().encodeToString(mac.doFinal("$now\nSECabc".toByteArray())), sign)
    }

    @Test
    fun feishuSignature() {
        val now = 1_700_000_000_123L
        val (_, json) = Webhook.build(Webhook.FEISHU, "https://open.feishu.cn/open-apis/bot/v2/hook/x", "sec", sms, "T", now)
        val o = JSONObject(json)
        assertEquals("1700000000", o.getString("timestamp"))
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec("1700000000\nsec".toByteArray(), "HmacSHA256")) }
        assertEquals(Base64.getEncoder().encodeToString(mac.doFinal(ByteArray(0))), o.getString("sign"))
        assertEquals("T", o.getJSONObject("content").getString("text"))
    }

    @Test
    fun plainHttpIsRefused() {
        try {
            Webhook.build(Webhook.CUSTOM, "http://example.com/hook", null, sms, "T", 0)
            fail("expected failure")
        } catch (e: DeliveryException) {
            assertTrue(e.permanent)
        }
    }

    @Test
    fun ntfyStreamParsing() {
        assertEquals("open", Ntfy.parse("{\"id\":\"a\",\"event\":\"open\",\"topic\":\"t\"}")!!.first)
        val m = Ntfy.parse("{\"id\":\"abc\",\"time\":1,\"event\":\"message\",\"topic\":\"t\",\"message\":\"SR1.xyz\"}")!!
        assertEquals("message", m.first)
        assertEquals("abc", m.second!!.id)
        assertEquals("SR1.xyz", m.second!!.message)
        assertEquals(null, Ntfy.parse("garbage"))
    }
}
