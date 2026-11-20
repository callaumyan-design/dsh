package com.smsrelay.secure.ui

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings as SystemSettings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.smsrelay.secure.BuildConfig
import com.smsrelay.secure.Notifier
import com.smsrelay.secure.R
import com.smsrelay.secure.RelayService
import com.smsrelay.secure.core.CodeExtractor
import com.smsrelay.secure.core.Formatter
import com.smsrelay.secure.data.Db
import com.smsrelay.secure.data.Settings
import com.smsrelay.secure.forward.Forwarder
import java.util.concurrent.Executors

class MainActivity : Activity() {
    lateinit var ui: Ui
    lateinit var settings: Settings
    private lateinit var content: LinearLayout
    private lateinit var scroll: ScrollView
    private val tabViews = ArrayList<TextView>()
    private var tab = 0
    private val handler = Handler(Looper.getMainLooper())
    private val background = Executors.newSingleThreadExecutor()
    private var refresher: Runnable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep pairing codes, passwords and SMS out of screenshots and the recent-apps preview.
        // (Debug builds allow screenshots so the UI can be checked during development.)
        if (!BuildConfig.DEBUG) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
        ui = Ui(this)
        settings = Settings(this)
        tab = intent?.getIntExtra(EXTRA_TAB, -1)?.takeIf { it >= 0 } ?: savedInstanceState?.getInt("tab") ?: 0
        setContentView(buildShell())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val t = intent.getIntExtra(EXTRA_TAB, -1)
        if (t >= 0) tab = t
    }

    override fun onResume() {
        super.onResume()
        show(tab, keepScroll = true)
        RelayService.sync(this)
    }

    override fun onPause() {
        ui.flush()
        stopRefresher()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt("tab", tab)
    }

    // ------------------------------------------------------------------ shell

    private fun buildShell(): View {
        val root = ui.vertical()
        root.setBackgroundColor(ui.color(R.color.bg))

        val header = ui.horizontal()
        header.setPadding(ui.dp(20), ui.dp(14), ui.dp(20), ui.dp(6))
        val title = TextView(this)
        title.text = getString(R.string.app_name)
        title.textSize = 22f
        title.typeface = Typeface.DEFAULT_BOLD
        title.setTextColor(ui.color(R.color.text))
        header.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val ver = TextView(this)
        ver.text = "v" + BuildConfig.VERSION_NAME
        ver.textSize = 12f
        ver.setTextColor(ui.color(R.color.sub))
        header.addView(ver)
        root.addView(header)

        scroll = ScrollView(this)
        scroll.isFillViewport = true
        content = ui.vertical()
        content.setPadding(ui.dp(16), 0, ui.dp(16), ui.dp(24))
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val nav = ui.horizontal()
        nav.setBackgroundColor(ui.color(R.color.nav))
        nav.elevation = ui.dp(8).toFloat()
        val names = listOf("首页", "发送", "接收", "说明")
        names.forEachIndexed { i, name ->
            val t = TextView(this)
            t.text = name
            t.gravity = Gravity.CENTER
            t.textSize = 15f
            t.setPadding(0, ui.dp(14), 0, ui.dp(14))
            t.setOnClickListener {
                ui.flush()
                show(i)
            }
            tabViews += t
            nav.addView(t, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        root.addView(nav)

        applyEdgeToEdge(root)
        return root
    }

    @Suppress("DEPRECATION")
    private fun applyEdgeToEdge(root: View) {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        } else {
            window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val i = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout(),
                )
                v.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                v.setPadding(
                    insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom,
                )
            }
            insets
        }
    }

    fun show(index: Int, keepScroll: Boolean = false) {
        ui.flush()
        val y = if (keepScroll && index == tab) scroll.scrollY else 0
        tab = index
        stopRefresher()
        tabViews.forEachIndexed { i, t ->
            t.setTextColor(ui.color(if (i == tab) R.color.accent else R.color.sub))
            t.typeface = if (i == tab) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        content.removeAllViews()
        when (tab) {
            0 -> buildHome()
            1 -> SendPage(this).build(content)
            2 -> ReceivePage(this).build(content)
            else -> GuidePage(this).build(content)
        }
        scroll.post { scroll.scrollTo(0, y) }
    }

    /** Rebuilds the current page (posted, so it is safe to call from inside a click handler). */
    fun refresh() {
        handler.post { if (!isFinishing && !isDestroyed) show(tab, keepScroll = true) }
    }

    fun startRefresher(periodMs: Long, block: () -> Unit) {
        stopRefresher()
        val r = object : Runnable {
            override fun run() {
                block()
                handler.postDelayed(this, periodMs)
            }
        }
        refresher = r
        handler.postDelayed(r, periodMs)
    }

    private fun stopRefresher() {
        refresher?.let { handler.removeCallbacks(it) }
        refresher = null
    }

    /** Runs [work] off the main thread and delivers the result back on it. */
    fun <T> runBackground(work: () -> T, done: (T) -> Unit) {
        background.execute {
            val r = work()
            runOnUiThread { if (!isFinishing && !isDestroyed) done(r) }
        }
    }

    fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    fun alert(title: String, message: String) {
        AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("好的", null).show()
    }

    fun testChannel(channel: String) {
        ui.flush()
        val dlg = AlertDialog.Builder(this).setTitle("正在发送测试消息…").setMessage("请稍候").setCancelable(false).show()
        runBackground({ Forwarder.test(applicationContext, channel) }) { err ->
            dlg.dismiss()
            if (err == null) {
                alert("✅ 发送成功", "测试消息已经通过「${Settings.channelName(channel)}」发出，请在接收的手机上查看。")
            } else {
                alert("❌ 发送失败", err)
            }
        }
    }

    // ------------------------------------------------------------------ permissions

    fun has(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    fun requestPerm(vararg permissions: String) {
        val missing = permissions.filter { !has(it) }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQ_PERMS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val blocked = permissions.indices.filter {
            grantResults.getOrNull(it) != PackageManager.PERMISSION_GRANTED && !shouldShowRequestPermissionRationale(permissions[it])
        }
        if (blocked.isNotEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("需要在系统设置里手动授权")
                .setMessage(
                    "系统没有弹出授权窗口（可能之前点了“拒绝”，或者系统把短信权限列为“受限设置”）。\n\n" +
                        "请在接下来打开的「应用信息」页面里：\n" +
                        "1. 如果右上角 ⋮ 菜单里有“允许受限制的设置”，先点它；\n" +
                        "2. 进入“权限”，把短信 / 通知设为允许。\n\n" +
                        "小米/红米手机还需要把“通知类短信”设为允许。",
                )
                .setPositiveButton("去设置") { _, _ -> openAppSettings() }
                .setNegativeButton("取消", null)
                .show()
        }
        refresh()
        RelayService.sync(this)
    }

    fun openAppSettings() {
        startActivity(Intent(SystemSettings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    }

    fun ignoringBatteryOptimizations(): Boolean =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    @android.annotation.SuppressLint("BatteryLife")
    fun requestIgnoreBatteryOptimizations() {
        try {
            startActivity(Intent(SystemSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (e: Exception) {
            startActivity(Intent(SystemSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    // ------------------------------------------------------------------ home page

    private fun buildHome() {
        val s = settings
        val c = ui.card(content)
        ui.toggle(c, "启用短信转发", "关闭后，本机收到的短信不再转发", s.forwardEnabled, top = 0) {
            s.forwardEnabled = it
            RelayService.sync(this)
        }
        ui.divider(c, 8)

        val smsOk = has(Manifest.permission.RECEIVE_SMS)
        ui.statusRow(c, smsOk, if (smsOk) "已允许读取新短信" else "还没有短信接收权限", "去授权") {
            requestPerm(Manifest.permission.RECEIVE_SMS)
        }
        if (s.smsEnabled) {
            val ok = has(Manifest.permission.SEND_SMS)
            ui.statusRow(c, ok, if (ok) "已允许发送短信（短信通道）" else "短信通道需要“发送短信”权限", "去授权") {
                requestPerm(Manifest.permission.SEND_SMS)
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            val ok = has(Manifest.permission.POST_NOTIFICATIONS)
            ui.statusRow(c, ok, if (ok) "已允许通知" else "还没有通知权限（失败提醒、接收短信要用）", "去授权") {
                requestPerm(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        val battery = ignoringBatteryOptimizations()
        ui.statusRow(c, battery, if (battery) "不受省电策略限制" else "可能被省电策略延迟或杀掉", "去设置") {
            requestIgnoreBatteryOptimizations()
        }
        val channels = s.enabledChannelIds()
        if (channels.isEmpty()) {
            ui.statusRow(c, false, "还没有开启任何转发通道", "去设置") { show(1) }
        } else {
            ui.statusRow(c, true, "已开启：" + channels.joinToString("、") { Settings.channelName(it) })
        }
        ui.divider(c, 8)
        ui.toggle(c, "后台常驻（推荐）", "显示一个常驻通知，防止系统清理后台导致漏转发", s.keepAlive) {
            s.keepAlive = it
            RelayService.sync(this)
        }

        val header = ui.horizontal()
        val st = TextView(this)
        st.text = "最近转发记录"
        st.textSize = 13f
        st.typeface = Typeface.DEFAULT_BOLD
        st.setTextColor(ui.color(R.color.sub))
        header.addView(st, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val clear = TextView(this)
        clear.text = "清空"
        clear.textSize = 13f
        clear.setTextColor(ui.color(R.color.accent))
        clear.setPadding(ui.dp(12), ui.dp(4), ui.dp(4), ui.dp(4))
        clear.setOnClickListener {
            AlertDialog.Builder(this).setMessage("清空本机的转发记录？（不影响手机里的短信）")
                .setPositiveButton("清空") { _, _ ->
                    Db.get(this).clearOutbox()
                    refresh()
                }
                .setNegativeButton("取消", null).show()
        }
        header.addView(clear)
        header.setPadding(ui.dp(4), 0, 0, 0)
        content.addView(header, ui.lp(top = 20))

        val list = ui.vertical()
        content.addView(list)
        outboxSignature = null
        fillOutbox(list)
        startRefresher(3000) { fillOutbox(list) }
    }

    private var outboxSignature: String? = null

    private fun fillOutbox(list: LinearLayout) {
        runBackground({ Db.get(this).recentOutbox(40) }) { items ->
            val sig = items.joinToString("|") { i -> "${i.id}:" + i.deliveries.joinToString(",") { "${it.state}/${it.attempts}" } }
            if (sig == outboxSignature) return@runBackground
            outboxSignature = sig
            list.removeAllViews()
            if (items.isEmpty()) {
                val c = ui.card(list)
                ui.note(c, "还没有转发记录。开启通道后，本机收到的短信会显示在这里。\n可以先到「发送」页点“发送测试消息”。", top = 0)
                return@runBackground
            }
            for (item in items) {
                val c = ui.card(list)
                val top = ui.horizontal()
                val from = TextView(this)
                from.text = item.sms.sender
                from.textSize = 15f
                from.typeface = Typeface.DEFAULT_BOLD
                from.setTextColor(ui.color(R.color.text))
                top.addView(from, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                val time = TextView(this)
                time.text = Formatter.shortTime(item.sms.time)
                time.textSize = 12f
                time.setTextColor(ui.color(R.color.sub))
                top.addView(time)
                c.addView(top)
                val body = ui.text(c, item.sms.body, 14f, top = 4)
                body.maxLines = 3
                body.ellipsize = android.text.TextUtils.TruncateAt.END
                val status = item.deliveries.joinToString("   ") { d ->
                    val name = Settings.channelName(d.channel)
                    when (d.state) {
                        Db.SENT -> "✓ $name"
                        Db.FAILED -> "✗ $name"
                        Db.CANCELLED -> "– $name"
                        else -> if (d.attempts == 0) "… $name" else "↻ $name"
                    }
                }
                val failed = item.deliveries.any { it.state == Db.FAILED }
                val retrying = item.deliveries.any { it.state == Db.PENDING && it.attempts > 0 }
                ui.text(
                    c, status, 12.5f,
                    when {
                        failed -> R.color.err
                        retrying -> R.color.warn
                        else -> R.color.ok
                    },
                    top = 6,
                )
                c.setOnClickListener { showOutboxItem(item) }
            }
        }
    }

    private fun showOutboxItem(item: Db.OutItem) {
        val msg = buildString {
            append(item.sms.body).append("\n\n")
            append("时间：").append(Formatter.time(item.sms.time)).append('\n')
            item.sms.sim?.let { append("卡槽：").append(it).append('\n') }
            append('\n')
            for (d in item.deliveries) {
                append(Settings.channelName(d.channel)).append("：")
                append(
                    when (d.state) {
                        Db.SENT -> "已送达"
                        Db.FAILED -> "失败 — ${d.error ?: ""}"
                        Db.CANCELLED -> "已取消（${d.error ?: ""}）"
                        else -> if (d.attempts == 0) "发送中" else "第 ${d.attempts} 次失败，稍后自动重试 — ${d.error ?: ""}"
                    },
                )
                append('\n')
            }
        }
        val b = AlertDialog.Builder(this).setTitle(item.sms.sender).setMessage(msg).setPositiveButton("关闭", null)
        if (item.deliveries.any { it.state == Db.FAILED || it.state == Db.PENDING }) {
            b.setNeutralButton("立即重试") { _, _ ->
                Db.get(this).retryMessage(item.id)
                Forwarder.kick(this)
                toast("已开始重试")
            }
        }
        b.show()
    }

    // ------------------------------------------------------------------ helpers for pages

    fun copy(label: String, text: String) {
        Notifier.copySensitive(this, label, text)
        if (Build.VERSION.SDK_INT < 33) toast("已复制")
    }

    fun codeOf(body: String) = CodeExtractor.extract(body)

    companion object {
        const val EXTRA_TAB = "tab"
        private const val REQ_PERMS = 7
    }
}
