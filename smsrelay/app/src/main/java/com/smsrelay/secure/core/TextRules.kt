package com.smsrelay.secure.core

/** Which incoming SMS get forwarded. */
object Filter {
    const val MODE_ALL = 0
    const val MODE_INCLUDE = 1

    fun keywords(text: String): List<String> =
        text.split(',', '，', ';', '；', '\n', '、')
            .map { it.trim() }
            .filter { it.isNotEmpty() }

    fun allows(mode: Int, include: String, exclude: String, sender: String, body: String): Boolean {
        val ex = keywords(exclude)
        if (ex.any { sender.contains(it, ignoreCase = true) || body.contains(it, ignoreCase = true) }) return false
        if (mode == MODE_INCLUDE) {
            val inc = keywords(include)
            if (inc.isEmpty()) return true
            return inc.any { sender.contains(it, ignoreCase = true) || body.contains(it, ignoreCase = true) }
        }
        return true
    }
}

/** Finds the one-time code in a verification SMS so it can be copied with one tap. */
object CodeExtractor {
    private val KEYWORDS = Regex(
        "验证码|校验码|动态码|确认码|安全码|认证码|激活码|动态密码|验证代码|驗證碼|校驗碼|code|otp|passcode|pin",
        RegexOption.IGNORE_CASE,
    )
    private val DIGITS = Regex("(?<![0-9A-Za-z])([0-9]{4,8})(?![0-9A-Za-z])")
    private val ALNUM = Regex("(?<![0-9A-Za-z])(?=[A-Za-z]*[0-9])(?=[0-9]*[A-Za-z])([0-9A-Za-z]{4,8})(?![0-9A-Za-z])")

    fun extract(body: String): String? {
        val kw = KEYWORDS.find(body) ?: return null
        val digits = DIGITS.findAll(body).toList()
        if (digits.isNotEmpty()) {
            return digits.minByOrNull { distance(it.range, kw.range) }!!.groupValues[1]
        }
        val alnum = ALNUM.findAll(body).filterNot { KEYWORDS.matches(it.value) }.toList()
        return alnum.minByOrNull { distance(it.range, kw.range) }?.groupValues?.get(1)
    }

    private fun distance(a: IntRange, b: IntRange): Int = when {
        a.first > b.last -> a.first - b.last
        b.first > a.last -> (b.first - a.last) + 1 // prefer codes that come after the keyword
        else -> 0
    }
}

/** Phone number comparison that ignores formatting and country prefixes. */
object PhoneNumbers {
    fun digits(n: String): String = n.filter { it.isDigit() }

    fun same(a: String, b: String): Boolean {
        val da = digits(a)
        val db = digits(b)
        if (da.length < 5 || db.length < 5) return false
        val k = minOf(8, da.length, db.length)
        return da.takeLast(k) == db.takeLast(k)
    }
}
