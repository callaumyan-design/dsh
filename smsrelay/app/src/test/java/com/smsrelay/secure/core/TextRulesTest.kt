package com.smsrelay.secure.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TextRulesTest {
    @Test
    fun extractsCodes() {
        assertEquals("482913", CodeExtractor.extract("【某银行】您的验证码是482913，5分钟内有效，请勿泄露。"))
        assertEquals("7731", CodeExtractor.extract("验证码：7731。您正在登录，2026年11月20日"))
        assertEquals("123456", CodeExtractor.extract("Your verification code is 123456. Do not share it."))
        assertEquals("A7K29Q", CodeExtractor.extract("您的动态码为 A7K29Q ，请在页面输入"))
        assertEquals("552019", CodeExtractor.extract("尾号8848的卡，校验码552019"))
        assertNull(CodeExtractor.extract("您本月账单金额为 1234 元"))
        assertNull(CodeExtractor.extract("晚上一起吃饭吗"))
    }

    @Test
    fun filters() {
        assertTrue(Filter.allows(Filter.MODE_ALL, "", "", "10086", "hello"))
        assertFalse(Filter.allows(Filter.MODE_ALL, "", "10086，退订", "10086", "hello"))
        assertFalse(Filter.allows(Filter.MODE_ALL, "", "退订", "95588", "回T退订"))
        assertTrue(Filter.allows(Filter.MODE_INCLUDE, "验证码,银行", "", "95588", "您的验证码是 1234"))
        assertFalse(Filter.allows(Filter.MODE_INCLUDE, "验证码,银行", "", "10010", "流量提醒"))
        assertTrue(Filter.allows(Filter.MODE_INCLUDE, "", "", "10010", "empty include list forwards all"))
    }

    @Test
    fun phoneNumbers() {
        assertTrue(PhoneNumbers.same("+86 138-0013-8000", "13800138000"))
        assertFalse(PhoneNumbers.same("13800138000", "13800138001"))
        assertFalse(PhoneNumbers.same("", "13800138000"))
    }

    @Test
    fun formatting() {
        val sms = Sms("u", "95588", "您的验证码是 1234，请在五分钟内输入完成登录操作，谢谢合作。", 0, null, "主力机")
        assertTrue(Formatter.plain(sms).contains("95588"))
        assertTrue(Formatter.emailSubject(sms).endsWith("…"))
        assertEquals("[转发]95588: " + sms.body, Formatter.compact(sms))
    }
}
