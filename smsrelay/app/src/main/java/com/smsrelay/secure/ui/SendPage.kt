package com.smsrelay.secure.ui

import android.Manifest
import android.app.AlertDialog
import android.graphics.Typeface
import android.net.Uri
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.smsrelay.secure.R
import com.smsrelay.secure.RelayService
import com.smsrelay.secure.core.Bark
import com.smsrelay.secure.core.Filter
import com.smsrelay.secure.core.Ntfy
import com.smsrelay.secure.core.Pairing
import com.smsrelay.secure.core.Telegram
import com.smsrelay.secure.core.Webhook
import com.smsrelay.secure.core.typeableKey
import com.smsrelay.secure.data.Settings
import com.smsrelay.secure.data.Settings.Companion.CH_BARK
import com.smsrelay.secure.data.Settings.Companion.CH_E2E
import com.smsrelay.secure.data.Settings.Companion.CH_EMAIL
import com.smsrelay.secure.data.Settings.Companion.CH_SMS
import com.smsrelay.secure.data.Settings.Companion.CH_TG
import com.smsrelay.secure.data.Settings.Companion.CH_WEBHOOK

/** The "发送" tab: what to forward and where to. */
class SendPage(private val a: MainActivity) {
    private val ui = a.ui
    private val s = a.settings

    private class EmailPreset(val name: String, val host: String, val port: Int, val startTls: Boolean, val help: String)

    private val presets = listOf(
        EmailPreset("QQ 邮箱", "smtp.qq.com", 465, false, "QQ 邮箱网页版 → 设置 → 账号 → 开启“SMTP 服务”→ 生成授权码。下面填写授权码，不是 QQ 密码。"),
        EmailPreset("163 邮箱", "smtp.163.com", 465, false, "163 邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启 SMTP 服务 → 获取授权码。"),
        EmailPreset("126 邮箱", "smtp.126.com", 465, false, "126 邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启 SMTP 服务 → 获取授权码。"),
        EmailPreset("Gmail", "smtp.gmail.com", 465, false, "Google 账号需先开启两步验证，然后在 Google 账号 → 安全 → “应用专用密码”里生成 16 位密码。"),
        EmailPreset("iCloud 邮箱", "smtp.mail.me.com", 587, true, "在 account.apple.com → 登录与安全 → “App 专用密码”里生成。发件邮箱要填 @icloud.com 地址。"),
        EmailPreset("其他（手动填写）", "", 465, false, "请向邮箱服务商查询 SMTP 服务器、端口和加密方式。本应用只使用加密连接。"),
    )

    fun build(root: LinearLayout) {
        // ---------- Basics & rules
        val basic = ui.card(root)
        ui.text(basic, "基本设置", 16f, bold = true)
        ui.input(basic, "本机名称（显示在转发内容里，方便区分多台手机）", s.deviceLabel, "例如：主力机") { s.deviceLabel = it.trim() }
        ui.picker(basic, "转发哪些短信", listOf("全部短信", "只转发包含关键词的短信"), s.filterMode) {
            s.filterMode = it
            a.refresh()
        }
        if (s.filterMode == Filter.MODE_INCLUDE) {
            ui.input(basic, "关键词（用逗号分隔）", s.includeKeywords, "例如：验证码，银行，快递", Ui.Kind.MULTILINE) { s.includeKeywords = it }
        }
        ui.input(basic, "不转发（含这些词或来自这些号码的短信，逗号分隔，可留空）", s.excludeKeywords, "例如：退订，10086", Ui.Kind.MULTILINE) {
            s.excludeKeywords = it
        }

        ui.section(root, "转发通道（可以同时开启多个）")
        e2eCard(root)
        barkCard(root)
        emailCard(root)
        smsCard(root)
        telegramCard(root)
        webhookCard(root)
    }

    /** A card with an enable switch; the body is only shown while enabled. */
    private fun channelCard(
        root: LinearLayout,
        channel: String,
        title: String,
        badge: String,
        badgeColor: Int,
        summary: String,
        enabled: Boolean,
        onToggle: (Boolean) -> Unit,
        body: (LinearLayout) -> Unit,
    ) {
        val c = ui.card(root)
        val head = ui.horizontal()
        val t = TextView(a)
        t.text = title
        t.textSize = 16.5f
        t.typeface = Typeface.DEFAULT_BOLD
        t.setTextColor(ui.color(R.color.text))
        head.addView(t)
        ui.badge(head, badge, badgeColor)
        c.addView(head)
        ui.note(c, summary, top = 4)
        val inner = ui.vertical()
        ui.toggle(c, "启用", null, enabled, top = 6) { on ->
            onToggle(on)
            inner.visibility = if (on) View.VISIBLE else View.GONE
            if (on && inner.childCount == 0) {
                body(inner)
                addTestButton(inner, channel)
            }
            RelayService.sync(a)
        }
        c.addView(inner)
        if (enabled) {
            body(inner)
            addTestButton(inner, channel)
        } else {
            inner.visibility = View.GONE
        }
    }

    private fun addTestButton(inner: LinearLayout, channel: String) {
        ui.button(inner, "发送测试消息", Ui.Btn.SECONDARY) { a.testChannel(channel) }
    }

    // ------------------------------------------------------------------ E2E

    private fun e2eCard(root: LinearLayout) {
        channelCard(
            root, CH_E2E, "加密推送到另一台安卓手机", "端到端加密 · 推荐", R.color.ok,
            "在另一台安卓手机上也安装本应用，作为“接收端”。短信在本机加密后才发出，中转服务器只能看到乱码。",
            s.e2eEnabled,
            onToggle = {
                s.e2eEnabled = it
                if (it && Pairing.normalize(s.e2eCode) == null) s.e2eCode = Pairing.generate()
            },
        ) { c ->
            if (Pairing.normalize(s.e2eCode) == null) s.e2eCode = Pairing.generate()
            ui.text(c, "配对码", 13f, R.color.sub, top = 12)
            val code = TextView(a)
            code.text = Pairing.format(Pairing.normalize(s.e2eCode)!!)
            code.textSize = 20f
            code.typeface = Typeface.MONOSPACE
            code.setTextColor(ui.color(R.color.text))
            code.background = ui.rounded(ui.color(R.color.field), 10, stroke = ui.color(R.color.divider))
            code.setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
            code.setTextIsSelectable(true)
            c.addView(code, ui.lp(top = 4))
            ui.note(
                c,
                "在接收的手机上打开本应用 →「接收」页 → 输入这个配对码。可以给多台手机输入同一个配对码。\n" +
                    "⚠️ 配对码就是钥匙：请当面输入，不要通过微信、短信、邮件发送，也不要截图。",
            )
            val row = ui.buttonRow(c)
            ui.button(row, "复制配对码", Ui.Btn.SECONDARY, weight = true) {
                a.copy("配对码", code.text.toString())
            }
            ui.button(row, "更换配对码", Ui.Btn.DANGER, weight = true) {
                AlertDialog.Builder(a)
                    .setTitle("更换配对码？")
                    .setMessage("旧配对码会立即失效，所有接收端都需要重新输入新的配对码。怀疑配对码泄露时使用。")
                    .setPositiveButton("更换") { _, _ ->
                        s.e2eCode = Pairing.generate()
                        a.refresh()
                    }
                    .setNegativeButton("取消", null)
                    .show()
            }
            ui.input(c, "中转服务器（一般不用改）", s.e2eServer, Ntfy.DEFAULT_SERVER, Ui.Kind.URL) {
                s.e2eServer = it.trim().ifEmpty { Ntfy.DEFAULT_SERVER }
            }
            ui.input(c, "访问令牌（使用自建 ntfy 服务器并开启认证时才需要，可留空）", s.e2eToken, "", Ui.Kind.PASSWORD) {
                s.e2eToken = it.trim()
            }
        }
    }

    // ------------------------------------------------------------------ Bark

    private fun barkCard(root: LinearLayout) {
        channelCard(
            root, CH_BARK, "推送到 iPhone（Bark）",
            if (s.barkEncrypt) "端到端加密" else "传输加密", if (s.barkEncrypt) R.color.ok else R.color.warn,
            "适合另一台是 iPhone 的情况：在 App Store 安装免费开源应用 Bark。开启加密后，Bark 服务器和苹果推送都看不到内容。",
            s.barkEnabled,
            onToggle = {
                s.barkEnabled = it
                ensureBarkKey()
            },
        ) { c ->
            ensureBarkKey()
            ui.input(c, "Bark 推送地址或 Device Key", s.barkDeviceKey, "打开 Bark 复制 https://api.day.app/ 开头的地址", Ui.Kind.PASSWORD) {
                val v = it.trim()
                if (v.startsWith("https://")) {
                    val u = Uri.parse(v)
                    val key = u.pathSegments.firstOrNull() ?: ""
                    s.barkDeviceKey = key
                    s.barkServer = "https://" + (u.host ?: "api.day.app") + (if (u.port > 0) ":${u.port}" else "")
                } else {
                    s.barkDeviceKey = v
                }
            }
            ui.note(c, "可以直接粘贴 Bark 首页显示的整条示例网址，会自动提取。")
            ui.toggle(c, "端到端加密（强烈推荐）", "需要在 Bark 里填入下面的密钥", s.barkEncrypt, top = 10) {
                s.barkEncrypt = it
                a.refresh()
            }
            if (s.barkEncrypt) {
                kv(c, "算法 Algorithm", "AES256")
                kv(c, "模式 Mode", "CBC")
                kv(c, "填充 Padding", "pkcs7")
                kv(c, "密钥 Key", s.barkKey, copy = true)
                kv(c, "IV", s.barkIv, copy = true)
                ui.note(
                    c,
                    "在 iPhone 的 Bark 里：首页右上角/设置 → “推送加密”(Encryption) → 按上面填写 → 保存。\n" +
                        "⚠️ 请对照屏幕在 iPhone 上手动输入（全是小写字母和数字），不要通过聊天软件发送密钥。",
                )
                ui.button(c, "重新生成密钥", Ui.Btn.DANGER) {
                    s.barkKey = typeableKey(32)
                    s.barkIv = typeableKey(16)
                    a.refresh()
                }
            }
            ui.input(c, "Bark 服务器（使用官方服务器则不用改）", s.barkServer, Bark.DEFAULT_SERVER, Ui.Kind.URL) {
                s.barkServer = it.trim().ifEmpty { Bark.DEFAULT_SERVER }
            }
        }
    }

    private fun ensureBarkKey() {
        if (s.barkKey.length != 32) s.barkKey = typeableKey(32)
        if (s.barkIv.length != 16) s.barkIv = typeableKey(16)
    }

    private fun kv(c: LinearLayout, k: String, v: String, copy: Boolean = false) {
        val row = ui.horizontal()
        val kt = TextView(a)
        kt.text = k
        kt.textSize = 13f
        kt.setTextColor(ui.color(R.color.sub))
        row.addView(kt, LinearLayout.LayoutParams(ui.dp(96), LinearLayout.LayoutParams.WRAP_CONTENT))
        val vt = TextView(a)
        vt.text = v
        vt.textSize = 15f
        vt.typeface = Typeface.MONOSPACE
        vt.setTextColor(ui.color(R.color.text))
        vt.setTextIsSelectable(true)
        row.addView(vt, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        if (copy) {
            val ct = TextView(a)
            ct.text = "复制"
            ct.textSize = 13f
            ct.setTextColor(ui.color(R.color.accent))
            ct.setPadding(ui.dp(10), ui.dp(6), 0, ui.dp(6))
            ct.setOnClickListener { a.copy(k, v) }
            row.addView(ct)
        }
        row.setPadding(0, ui.dp(5), 0, ui.dp(5))
        c.addView(row, ui.lp(top = 4))
    }

    // ------------------------------------------------------------------ Email

    private fun emailCard(root: LinearLayout) {
        channelCard(
            root, CH_EMAIL, "发送到邮箱", "传输加密", R.color.warn,
            "任何手机（包括 iPhone）都能收邮件。连接全程 TLS 加密，但邮箱服务商能看到内容。",
            s.emailEnabled,
            onToggle = { s.emailEnabled = it },
        ) { c ->
            val idx = s.emailPreset.coerceIn(0, presets.size - 1)
            ui.picker(c, "邮箱类型（用来发信的邮箱）", presets.map { it.name }, idx) { i ->
                val p = presets[i]
                s.emailPreset = i
                if (p.host.isNotEmpty()) {
                    s.smtpHost = p.host
                    s.smtpPort = p.port
                    s.smtpStartTls = p.startTls
                }
                a.refresh()
            }
            ui.note(c, presets[idx].help)
            if (presets[idx].host.isEmpty()) {
                ui.input(c, "SMTP 服务器", s.smtpHost, "例如 smtp.example.com", Ui.Kind.URL) { s.smtpHost = it.trim() }
                ui.input(c, "端口", s.smtpPort.toString(), "465", Ui.Kind.NUMBER) { v ->
                    v.toIntOrNull()?.let { s.smtpPort = it }
                }
                ui.picker(c, "加密方式", listOf("SSL/TLS（通常端口 465）", "STARTTLS（通常端口 587）"), if (s.smtpStartTls) 1 else 0) {
                    s.smtpStartTls = it == 1
                }
            }
            ui.input(c, "发件邮箱地址", s.smtpUser, "例如 123456@qq.com", Ui.Kind.EMAIL) { s.smtpUser = it.trim() }
            ui.input(c, "授权码 / 应用专用密码", s.smtpPass, "", Ui.Kind.PASSWORD) { s.smtpPass = it }
            ui.input(c, "收件邮箱（可填多个，用逗号分隔；留空则发给自己）", s.emailTo, "", Ui.Kind.EMAIL) { s.emailTo = it.trim() }
        }
    }

    // ------------------------------------------------------------------ SMS

    private fun smsCard(root: LinearLayout) {
        channelCard(
            root, CH_SMS, "转发到另一个手机号（短信）", "不加密", R.color.err,
            "不需要网络，适合对方没有网络的情况。会产生短信费用，运营商能看到内容。",
            s.smsEnabled,
            onToggle = {
                s.smsEnabled = it
                if (it) a.requestPerm(Manifest.permission.SEND_SMS)
            },
        ) { c ->
            ui.input(c, "接收号码", s.smsTarget, "例如 13800138000", Ui.Kind.PHONE) { s.smsTarget = it.trim() }
            ui.note(c, "为防止两台手机互相转发形成循环，每小时最多转发 30 条短信，且不会转发对方号码转发回来的短信。")
        }
    }

    // ------------------------------------------------------------------ Telegram

    private fun telegramCard(root: LinearLayout) {
        channelCard(
            root, CH_TG, "Telegram 机器人", "传输加密", R.color.warn,
            "Telegram 服务器能看到内容。中国大陆网络无法直接使用。",
            s.tgEnabled,
            onToggle = { s.tgEnabled = it },
        ) { c ->
            ui.note(c, "1. 在 Telegram 里搜索 @BotFather，发送 /newbot 创建机器人，复制它给你的 Token。\n2. 给你的新机器人随便发一句话。\n3. 回到这里点“自动获取 Chat ID”。")
            ui.input(c, "Bot Token", s.tgToken, "123456789:ABC...", Ui.Kind.PASSWORD) { s.tgToken = it.trim() }
            val chat = ui.input(c, "Chat ID", s.tgChatId, "", Ui.Kind.TEXT) { s.tgChatId = it.trim() }
            ui.button(c, "自动获取 Chat ID", Ui.Btn.SECONDARY) {
                ui.flush()
                a.runBackground({
                    try {
                        Telegram.latestChatId(s.tgToken) ?: "!没有找到消息：请先给你的机器人发一句话，再点这里。"
                    } catch (e: Exception) {
                        "!" + (e.message ?: "获取失败")
                    }
                }) { r ->
                    if (r.startsWith("!")) {
                        a.alert("获取失败", r.substring(1))
                    } else {
                        chat.setText(r)
                        s.tgChatId = r
                        a.toast("已获取 Chat ID")
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ Webhook

    private fun webhookCard(root: LinearLayout) {
        channelCard(
            root, CH_WEBHOOK, "企业微信 / 钉钉 / 飞书群机器人", "传输加密", R.color.warn,
            "推送到工作软件的群聊。对应平台能看到内容，建议只在自己一个人的群里使用。",
            s.whEnabled,
            onToggle = { s.whEnabled = it },
        ) { c ->
            ui.picker(c, "类型", Webhook.NAMES, s.whType) {
                s.whType = it
                a.refresh()
            }
            val help = when (s.whType) {
                Webhook.WECOM -> "企业微信群 → 右上角 ⋯ → 添加群机器人 → 复制 Webhook 地址。"
                Webhook.DINGTALK -> "钉钉群 → 设置 → 机器人 → 添加“自定义”机器人，安全设置建议选“加签”，复制 Webhook 地址和加签密钥。"
                Webhook.FEISHU -> "飞书群 → 设置 → 群机器人 → 添加“自定义机器人”，可开启“签名校验”，复制 Webhook 地址和密钥。"
                else -> "以 JSON 格式 POST 到你自己的 https 接口，字段：from, body, time, time_text, device, sim, text。"
            }
            ui.note(c, help)
            ui.input(c, "Webhook 地址", s.whUrl, "https://…", Ui.Kind.PASSWORD) { s.whUrl = it.trim() }
            if (s.whType == Webhook.DINGTALK || s.whType == Webhook.FEISHU) {
                ui.input(c, "加签 / 签名校验密钥（没开启可留空）", s.whSecret, "", Ui.Kind.PASSWORD) { s.whSecret = it.trim() }
            }
        }
    }
}
