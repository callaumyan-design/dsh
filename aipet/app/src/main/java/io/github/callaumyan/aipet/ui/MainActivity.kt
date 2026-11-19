package io.github.callaumyan.aipet.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.material.chip.Chip
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import io.github.callaumyan.aipet.App
import io.github.callaumyan.aipet.BuildConfig
import io.github.callaumyan.aipet.R
import io.github.callaumyan.aipet.ai.ApiKind
import io.github.callaumyan.aipet.ai.Providers
import io.github.callaumyan.aipet.chat.Persona
import io.github.callaumyan.aipet.databinding.ActivityMainBinding
import io.github.callaumyan.aipet.pet.Effect
import io.github.callaumyan.aipet.pet.Face
import io.github.callaumyan.aipet.pet.Overlay
import io.github.callaumyan.aipet.pet.PetPalette
import io.github.callaumyan.aipet.pet.PetService
import io.github.callaumyan.aipet.pet.PetStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private val app get() = App.instance
    private val prefs get() = app.prefs
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var loading = false

    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) openAppNotificationSettings()
        refreshStatus()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        setupEdgeToEdge()
        setupHero()
        setupPermissions()
        setupAi()
        setupPersona()
        setupAppearance()
        b.version.text = "版本 ${BuildConfig.VERSION_NAME} · 所有设置和聊天记录都只存在这台手机上"
        scope.launch { PetService.visible.collect { refreshToggle() } }
        scope.launch { PetService.status.collect { refreshPetStatus(it) } }
    }

    override fun onResume() {
        super.onResume()
        b.preview.running = true
        refreshStatus()
        refreshPetStatus(PetService.status.value)
    }

    override fun onPause() {
        super.onPause()
        b.preview.running = false
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun setupEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        WindowInsetsControllerCompat(window, b.root).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }
        ViewCompat.setOnApplyWindowInsetsListener(b.scroll) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            b.content.setPadding(dp(16) + bars.left, bars.top + dp(8), dp(16) + bars.right, bars.bottom + dp(24))
            insets
        }
    }

    // ---------------- 顶部预览 ----------------

    @SuppressLint("ClickableViewAccessibility")
    private fun setupHero() {
        b.preview.bodySize = dp(96).toFloat()
        b.preview.palette = PetPalette.get(prefs.colorIndex)
        b.heroName.text = prefs.petName
        b.preview.setOnTouchListener { v, e ->
            if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) {
                b.preview.pokeAt(e.x, e.y)
                b.preview.flash(Face.HAPPY, 1200)
                b.preview.effect(Effect.HEARTS)
                v.performClick()
            }
            true
        }
    }

    // ---------------- 权限 & 召唤 ----------------

    private fun setupPermissions() {
        b.btnOverlay.setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
            }
            Toast.makeText(this, "在列表里找到“AI小桌宠”，把开关打开，再返回这里", Toast.LENGTH_LONG).show()
        }
        b.btnNotif.setOnClickListener {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                openAppNotificationSettings()
            }
        }
        b.btnBattery.setOnClickListener {
            try {
                @SuppressLint("BatteryLife")
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                startActivity(i)
            } catch (_: Exception) {
                try {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                } catch (_: Exception) {
                    openAppDetails()
                }
            }
        }
        b.btnToggle.setOnClickListener {
            if (PetService.visible.value) {
                PetService.start(this, PetService.ACTION_HIDE)
            } else {
                if (!Overlay.canDraw(this)) {
                    Toast.makeText(this, "先完成第 ① 步：允许显示在其他应用上层", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                PetService.start(this, PetService.ACTION_SHOW)
                Toast.makeText(this, "${prefs.petName}出来啦！回到桌面看看吧～", Toast.LENGTH_SHORT).show()
            }
        }
        b.btnChat.setOnClickListener {
            if (!Overlay.canDraw(this)) {
                Toast.makeText(this, "先完成第 ① 步：允许显示在其他应用上层", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            PetService.start(this, PetService.ACTION_CHAT)
        }
    }

    private fun refreshStatus() {
        val overlayOk = Overlay.canDraw(this)
        val notifOk = NotificationManagerCompat.from(this).areNotificationsEnabled()
        val batteryOk = getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(packageName) ?: true
        mark(b.txtOverlay, b.btnOverlay, overlayOk, "① 允许“显示在其他应用上层”")
        mark(b.txtNotif, b.btnNotif, notifOk, "② 允许通知（让它能在后台常驻）")
        mark(b.txtBattery, b.btnBattery, batteryOk, "③ 不让系统省电时把它清理掉（推荐）")
        refreshToggle()
    }

    private fun refreshPetStatus(st: PetStatus?) {
        val mood = st?.mood ?: prefs.savedMood
        val energy = st?.energy ?: prefs.savedEnergy
        val aff = st?.affection ?: prefs.memory.affection
        val moodWord = when {
            st?.annoyance ?: 0f > 55 -> "有点生气"
            mood > 80 -> "超开心"
            mood > 60 -> "开心"
            mood > 40 -> "还行"
            mood > 20 -> "有点低落"
            else -> "很难过"
        }
        val energyWord = when {
            st?.asleep == true -> "正在睡觉"
            energy > 70 -> "精神满满"
            energy > 40 -> "还有精神"
            energy > 20 -> "有点困"
            else -> "困得不行"
        }
        val affWord = when {
            aff > 85 -> "形影不离"
            aff > 65 -> "最喜欢你"
            aff > 45 -> "很亲近"
            aff > 25 -> "慢慢熟悉"
            else -> "刚认识"
        }
        b.lblMood.text = "心情：$moodWord"
        b.barMood.setProgressCompat(mood.toInt(), true)
        b.lblEnergy.text = "精力：$energyWord"
        b.barEnergy.setProgressCompat(energy.toInt(), true)
        b.lblAffection.text = "亲密度：$affWord"
        b.barAffection.setProgressCompat(aff.toInt(), true)
        val pets = prefs.todayCount("pet")
        val feeds = prefs.todayCount("feed")
        val pokes = prefs.todayCount("poke")
        val throws = prefs.todayCount("throw")
        b.todayStats.text = "今天：摸摸 $pets 次 · 喂食 $feeds 次 · 戳了 $pokes 下 · 扔了 $throws 次"
        b.heroSub.text = "我们认识的第 ${prefs.daysTogether} 天"
    }

    private fun mark(text: android.widget.TextView, button: View, ok: Boolean, label: String) {
        text.text = if (ok) "$label  ✓" else label
        text.setTextColor(getColor(if (ok) R.color.ok else R.color.text_main))
        button.visibility = if (ok) View.GONE else View.VISIBLE
    }

    private fun refreshToggle() {
        b.btnToggle.text = if (PetService.visible.value) "收起它" else "让它出来"
    }

    private fun openAppNotificationSettings() {
        try {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        } catch (_: Exception) {
            openAppDetails()
        }
    }

    private fun openAppDetails() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
        }
    }

    // ---------------- AI 设置 ----------------

    private fun setupAi() {
        b.provider.setSimpleItems(Providers.all.map { it.label }.toTypedArray())
        b.provider.setOnItemClickListener { _, _, position, _ ->
            prefs.providerId = Providers.all[position].id
            loadProviderFields()
        }
        loadProviderFields()

        b.apiKey.onChange { if (!loading) prefs.setApiKey(prefs.providerId, it) }
        b.model.onChange { if (!loading) prefs.setModel(prefs.providerId, it) }
        b.baseUrl.onChange { if (!loading) prefs.setBaseUrl(prefs.providerId, it) }

        b.btnGetKey.setOnClickListener {
            val url = prefs.provider.keyUrl
            if (url.isNotEmpty()) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: Exception) {
                    Toast.makeText(this, url, Toast.LENGTH_LONG).show()
                }
            }
        }
        b.btnAdvanced.setOnClickListener {
            b.baseLayout.visibility = if (b.baseLayout.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
        b.btnModels.setOnClickListener { pickModel() }
        b.btnTest.setOnClickListener { testConnection() }
    }

    private fun loadProviderFields() {
        loading = true
        val p = prefs.provider
        b.provider.setText(p.label, false)
        b.providerNote.text = p.note
        b.apiKey.setText(prefs.apiKey(p.id))
        b.model.setText(prefs.model(p.id))
        b.baseUrl.setText(prefs.baseUrl(p.id))
        b.baseLayout.visibility = if (p.id == "custom") View.VISIBLE else View.GONE
        b.btnAdvanced.visibility = if (p.id == "custom") View.GONE else View.VISIBLE
        b.btnGetKey.visibility = if (p.keyUrl.isEmpty()) View.GONE else View.VISIBLE
        b.keyLayout.hint = if (p.kind == ApiKind.CLAUDE) "API Key（以 sk-ant- 开头）" else "API Key（钥匙）"
        b.testResult.visibility = View.GONE
        loading = false
    }

    private fun pickModel() {
        b.btnModels.isEnabled = false
        b.btnModels.text = "加载中…"
        scope.launch {
            try {
                val models = app.chat.listModels()
                if (models.isEmpty()) {
                    Toast.makeText(this@MainActivity, "这家服务没有返回模型列表，请手动填写", Toast.LENGTH_LONG).show()
                } else {
                    MaterialAlertDialogBuilder(this@MainActivity)
                        .setTitle("选一个模型")
                        .setItems(models.toTypedArray()) { _, which -> b.model.setText(models[which]) }
                        .setNegativeButton("取消", null)
                        .show()
                }
            } catch (e: Exception) {
                MaterialAlertDialogBuilder(this@MainActivity)
                    .setTitle("拿不到模型列表")
                    .setMessage(e.message ?: e.toString())
                    .setPositiveButton("知道了", null)
                    .show()
            } finally {
                b.btnModels.isEnabled = true
                b.btnModels.text = "选模型"
            }
        }
    }

    private fun testConnection() {
        b.btnTest.isEnabled = false
        b.testResult.visibility = View.VISIBLE
        b.testResult.setTextColor(getColor(R.color.text_sub))
        b.testResult.text = "正在连接……"
        b.preview.face = Face.THINK
        scope.launch {
            try {
                val reply = app.chat.testConnection()
                b.testResult.setTextColor(getColor(R.color.ok))
                b.testResult.text = "✓ 连接成功！${prefs.petName}说：$reply"
                b.preview.face = Face.NORMAL
                b.preview.flash(Face.HAPPY, 2000)
            } catch (e: Exception) {
                b.testResult.setTextColor(getColor(R.color.warn))
                b.testResult.text = "✗ ${e.message ?: e.toString()}"
                b.preview.face = Face.SAD
            } finally {
                b.btnTest.isEnabled = true
            }
        }
    }

    // ---------------- 性格 ----------------

    private fun setupPersona() {
        loading = true
        b.petName.setText(prefs.petName)
        b.userCall.setText(prefs.userCall)
        b.personaText.setText(prefs.personaText)
        b.aboutMe.setText(prefs.aboutMe)
        loading = false

        b.petName.onChange {
            if (!loading) {
                prefs.petName = it
                b.heroName.text = prefs.petName
            }
        }
        b.userCall.onChange { if (!loading) prefs.userCall = it }
        b.personaText.onChange { if (!loading) prefs.personaText = it }
        b.aboutMe.onChange { if (!loading) prefs.aboutMe = it }

        for (p in Persona.presets) {
            val chip = Chip(this).apply {
                text = p.title
                isCheckable = true
                isChecked = p.id == prefs.personaId
                setOnClickListener {
                    if (prefs.personaId == p.id && b.personaText.text.toString() == p.text) return@setOnClickListener
                    prefs.personaId = p.id
                    b.personaText.setText(p.text)
                    isChecked = true
                }
            }
            b.personaChips.addView(chip)
        }
    }

    // ---------------- 样子和习惯 ----------------

    private fun setupAppearance() {
        PetPalette.all.forEachIndexed { index, pal ->
            val dot = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(pal.body)
                setStroke(dp(2), pal.outline)
                setSize(dp(18), dp(18))
            }
            val chip = Chip(this).apply {
                text = pal.name
                chipIcon = dot
                isChipIconVisible = true
                isCheckable = true
                isCheckedIconVisible = false
                isChecked = index == prefs.colorIndex
                chipStrokeWidth = dp(1).toFloat()
                setOnClickListener {
                    prefs.colorIndex = index
                    b.preview.palette = pal
                    b.preview.flash(Face.HAPPY, 1200)
                }
            }
            chip.chipBackgroundColor = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(getColor(R.color.brand_container), getColor(R.color.card_bg)),
            )
            b.colorChips.addView(chip)
        }

        val scale = ((prefs.scalePercent / 10f).toInt() * 10).coerceIn(60, 160)
        b.sizeSlider.value = scale.toFloat()
        b.sizeLabel.text = "大小：$scale%"
        b.sizeSlider.addOnChangeListener { _, value, fromUser ->
            b.sizeLabel.text = "大小：${value.toInt()}%"
            if (fromUser) prefs.scalePercent = value.toInt()
        }

        b.swGravity.isChecked = prefs.gravity
        b.swMotion.isChecked = prefs.senseMotion
        b.swMusic.isChecked = prefs.senseMusic
        b.swGravity.setOnCheckedChangeListener { _, v -> prefs.gravity = v }
        b.swMotion.setOnCheckedChangeListener { _, v -> prefs.senseMotion = v }
        b.swMusic.setOnCheckedChangeListener { _, v -> prefs.senseMusic = v }
        b.swWander.isChecked = prefs.wander
        b.swProactive.isChecked = prefs.proactive
        b.swProactiveAi.isChecked = prefs.proactiveAi
        b.swTts.isChecked = prefs.tts
        b.swAutostart.isChecked = prefs.autoStart
        b.swWander.setOnCheckedChangeListener { _, v -> prefs.wander = v }
        b.swProactive.setOnCheckedChangeListener { _, v -> prefs.proactive = v }
        b.swProactiveAi.setOnCheckedChangeListener { _, v -> prefs.proactiveAi = v }
        b.swTts.setOnCheckedChangeListener { _, v -> prefs.tts = v }
        b.swAutostart.setOnCheckedChangeListener { _, v -> prefs.autoStart = v }

        b.btnClear.setOnClickListener {
            MaterialAlertDialogBuilder(this)
                .setTitle("清空聊天记忆？")
                .setMessage("${prefs.petName}会忘掉之前所有的聊天内容（你写的“关于你的事”会保留）。")
                .setPositiveButton("清空") { _, _ ->
                    app.chat.clear()
                    Toast.makeText(this, "已清空", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("算了", null)
                .show()
        }
    }

    private fun EditText.onChange(block: (String) -> Unit) {
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) = block(s?.toString() ?: "")
        })
    }
}
