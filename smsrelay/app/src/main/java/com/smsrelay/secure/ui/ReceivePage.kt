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
import com.smsrelay.secure.core.Remote
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.remote.RemoteSms
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

        val remoteRefresh = if (s.rxEnabled && Pairing.normalize(s.rxCode) != null) remoteCard(root) else null

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
            remoteRefresh?.invoke()
        }
    }

    /** Draft survives page rebuilds (kept in memory only, never written to disk). */
    private object Draft {
        var to = ""
        var body = ""
        var sim = 0
    }

    /** "远程发短信": ask the sending phone to send an SMS through its SIM card. Returns a refresh callback. */
    private fun remoteCard(root: LinearLayout): () -> Unit {
        val c = ui.card(root)
        ui.text(c, "远程发短信", 16.5f, bold = true)
        ui.note(
            c,
            "用发送端手机的 SIM 卡给任意号码发短信。需要先在发送端「发送」页 → 加密推送里开启“允许接收端远程发短信”。",
            top = 4,
        )
        val toInput = ui.input(c, "收件号码", Draft.to, "例如 13800138000", Ui.Kind.PHONE) { Draft.to = it }
        val bodyInput = ui.input(c, "短信内容", Draft.body, "", Ui.Kind.MULTILINE) { Draft.body = it }
        ui.picker(c, "用发送端的哪张卡", listOf("默认卡", "卡1", "卡2"), Draft.sim) { Draft.sim = it }
        ui.button(c, "发送") {
            val to = toInput.text.toString().trim()
            val body = bodyInput.text.toString()
            Draft.to = to
            Draft.body = body
            val err = Remote.validateContent(to, body)
            if (err != null) {
                a.alert("无法发送", err)
                return@button
            }
            AlertDialog.Builder(a)
                .setTitle("确认发送")
                .setMessage("通过发送端手机给 $to 发送：\n\n$body\n\n可能产生短信费用。")
                .setPositiveButton("发送") { _, _ ->
                    a.runBackground({ RemoteSms.request(a.applicationContext, to, body, Draft.sim - 1) }) { e ->
                        if (e == null) {
                            Draft.body = ""
                            bodyInput.setText("")
                            a.toast("指令已加密发出，等待发送端确认")
                        } else {
                            a.alert("发送失败", e)
                        }
                    }
                }
                .setNegativeButton("取消", null)
                .show()
        }
        val list = ui.vertical()
        c.addView(list)
        var sig: String? = null
        fun fill() {
            a.runBackground({ Db.get(a).recentRemote(Db.ROLE_OUT, 10) }) { items ->
                val now = System.currentTimeMillis()
                val newSig = items.joinToString { it.id + it.status + ((now - it.created) / 60_000).coerceAtMost(5) }
                if (newSig == sig) return@runBackground
                sig = newSig
                list.removeAllViews()
                if (items.isNotEmpty()) ui.text(list, "最近发送", 13f, R.color.sub, top = 14)
                for (it in items) {
                    val age = now - it.created
                    val (text, color) = when (it.status) {
                        Remote.SENT -> "✅ 已由发送端发出" to R.color.ok
                        Remote.FAILED -> "❌ ${it.detail ?: "失败"}" to R.color.err
                        Remote.ACCEPTED -> if (age < 3 * 60_000) "📤 发送端已收到，正在发送…" to R.color.sub
                        else "⚠️ 发送端没有报告结果，请在发送端查看" to R.color.warn
                        else -> if (age < 2 * 60_000) "⏳ 等待发送端确认…" to R.color.sub
                        else "⚠️ 发送端没有响应：请确认它开启了“允许接收端远程发短信”并且联网" to R.color.warn
                    }
                    val sim = when (it.sim) { 0 -> " · 卡1"; 1 -> " · 卡2"; else -> "" }
                    ui.text(list, "→ ${it.to} · ${Formatter.shortTime(it.created)}$sim", 14f, bold = true, top = 10)
                    ui.text(list, it.body.take(80), 13.5f, top = 2)
                    ui.text(list, text, 13f, color, top = 2)
                }
            }
        }
        fill()
        return ::fill
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
