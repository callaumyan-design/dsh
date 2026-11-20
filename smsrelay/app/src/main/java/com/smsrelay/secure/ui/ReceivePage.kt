package com.smsrelay.secure.ui

import android.Manifest
import android.app.AlertDialog
import android.graphics.Typeface
import android.os.Build
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.smsrelay.secure.R
import com.smsrelay.secure.RelayService
import com.smsrelay.secure.core.Formatter
import com.smsrelay.secure.core.Ntfy
import com.smsrelay.secure.core.Pairing
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.receive.RxStatus

/** The "接收" tab: this phone receives SMS forwarded (encrypted) from another phone. */
class ReceivePage(private val a: MainActivity) {
    private val ui = a.ui
    private val s = a.settings

    fun build(root: LinearLayout) {
        val c = ui.card(root)
        ui.text(c, "本机作为接收端", 16.5f, bold = true)
        ui.note(c, "在发送短信的那台手机上开启「加密推送到另一台安卓手机」，然后把它显示的配对码输入到下面。", top = 4)

        val codeInput = ui.input(c, "配对码", s.rxCode.let { Pairing.normalize(it)?.let(Pairing::format) ?: it }, "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", Ui.Kind.CODE) { v ->
            val old = Pairing.normalize(s.rxCode)
            s.rxCode = v.trim()
            if (Pairing.normalize(v) != old) s.rxSince = ""
        }
        val codeState = ui.note(c, "")
        fun updateCodeState(v: String) {
            val ok = Pairing.normalize(v) != null
            codeState.text = when {
                v.isBlank() -> "共 24 位，字母不区分大小写，横线可以不输入。"
                ok -> "✅ 配对码格式正确"
                else -> "⚠️ 配对码不完整或有输错的字符"
            }
            codeState.setTextColor(ui.color(if (ok || v.isBlank()) R.color.sub else R.color.warn))
        }
        updateCodeState(codeInput.text.toString())
        codeInput.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
            override fun onTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
            override fun afterTextChanged(e: android.text.Editable?) = updateCodeState(e?.toString() ?: "")
        })

        ui.input(c, "中转服务器（与发送端一致，一般不用改）", s.rxServer, Ntfy.DEFAULT_SERVER, Ui.Kind.URL) {
            s.rxServer = it.trim().ifEmpty { Ntfy.DEFAULT_SERVER }
        }
        ui.input(c, "访问令牌（与发送端一致，没有就留空）", s.rxToken, "", Ui.Kind.PASSWORD) { s.rxToken = it.trim() }

        ui.toggle(c, "开始接收", "开启后会显示一个常驻通知，保持与中转服务器的加密连接", s.rxEnabled, top = 12) { on ->
            ui.flush()
            if (on && Pairing.normalize(s.rxCode) == null) {
                a.alert("配对码不正确", "请先输入发送端显示的 24 位配对码。")
                a.refresh()
                return@toggle
            }
            s.rxEnabled = on
            if (on && Build.VERSION.SDK_INT >= 33) a.requestPerm(Manifest.permission.POST_NOTIFICATIONS)
            RelayService.sync(a, restartReceiver = true)
            a.refresh()
        }
        if (s.rxEnabled) {
            ui.button(c, "保存并重新连接", Ui.Btn.SECONDARY) {
                ui.flush()
                if (Pairing.normalize(s.rxCode) == null) {
                    a.alert("配对码不正确", "请检查配对码。")
                } else {
                    RelayService.sync(a, restartReceiver = true)
                    a.toast("正在重新连接")
                }
            }
        }
        val status = ui.text(c, "", 14f, top = 12)
        fun updateStatus() {
            status.text = if (!s.rxEnabled) {
                "○ 未开启接收"
            } else {
                "● " + RxStatus.state + (if (RxStatus.detail.isNotEmpty()) "\n" + RxStatus.detail else "")
            }
            status.setTextColor(
                ui.color(
                    when {
                        !s.rxEnabled -> R.color.sub
                        RxStatus.state.startsWith("已连接") -> R.color.ok
                        else -> R.color.warn
                    },
                ),
            )
        }
        updateStatus()
        if (s.rxEnabled && !a.ignoringBatteryOptimizations()) {
            ui.statusRow(c, false, "建议允许后台运行，否则可能延迟收到", "去设置") { a.requestIgnoreBatteryOptimizations() }
        }

        // ---------- Inbox
        val header = ui.horizontal()
        val t = TextView(a)
        t.text = "收到的短信"
        t.textSize = 13f
        t.typeface = Typeface.DEFAULT_BOLD
        t.setTextColor(ui.color(R.color.sub))
        header.addView(t, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val clear = TextView(a)
        clear.text = "清空"
        clear.textSize = 13f
        clear.setTextColor(ui.color(R.color.accent))
        clear.setPadding(ui.dp(12), ui.dp(4), ui.dp(4), ui.dp(4))
        clear.setOnClickListener {
            AlertDialog.Builder(a).setMessage("清空本机收到的转发短信记录？")
                .setPositiveButton("清空") { _, _ ->
                    Db.get(a).clearInbox()
                    a.refresh()
                }
                .setNegativeButton("取消", null).show()
        }
        header.addView(clear)
        header.setPadding(ui.dp(4), 0, 0, 0)
        root.addView(header, ui.lp(top = 20))
        val list = ui.vertical()
        root.addView(list)
        var lastTop = -1L
        fun fill() {
            a.runBackground({ Db.get(a).recentInbox(60) }) { items ->
                val top = items.firstOrNull()?.id ?: 0L
                if (top == lastTop) return@runBackground
                lastTop = top
                list.removeAllViews()
                if (items.isEmpty()) {
                    val e = ui.card(list)
                    ui.note(e, "还没有收到转发的短信。可以在发送端点“发送测试消息”试试。", top = 0)
                }
                for (item in items) inboxItem(list, item)
            }
        }
        fill()
        a.startRefresher(1500) {
            updateStatus()
            fill()
        }
    }

    private fun inboxItem(list: LinearLayout, item: Db.InItem) {
        val c = ui.card(list)
        val top = ui.horizontal()
        val from = TextView(a)
        from.text = item.sms.sender
        from.textSize = 15f
        from.typeface = Typeface.DEFAULT_BOLD
        from.setTextColor(ui.color(R.color.text))
        top.addView(from, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val time = TextView(a)
        time.text = Formatter.shortTime(item.sms.time)
        time.textSize = 12f
        time.setTextColor(ui.color(R.color.sub))
        top.addView(time)
        c.addView(top)
        ui.text(c, item.sms.body, 14.5f, top = 4).setTextIsSelectable(true)
        ui.note(c, "来自 " + item.sms.device + (item.sms.sim?.let { " · $it" } ?: ""), top = 4)
        val row = ui.buttonRow(c, top = 8)
        val code = a.codeOf(item.sms.body)
        if (code != null) {
            ui.button(row, "复制验证码 $code", Ui.Btn.PRIMARY, weight = true) { a.copy("验证码", code) }
        }
        ui.button(row, "复制全文", Ui.Btn.SECONDARY, weight = true) { a.copy("短信", item.sms.body) }
    }
}
