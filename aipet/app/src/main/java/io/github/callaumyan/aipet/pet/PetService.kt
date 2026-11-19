package io.github.callaumyan.aipet.pet

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.util.Log
import android.view.ContextThemeWrapper
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.github.callaumyan.aipet.App
import io.github.callaumyan.aipet.R
import io.github.callaumyan.aipet.chat.PetEvent
import io.github.callaumyan.aipet.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.random.Random

/**
 * 常驻服务：让桌宠一直待在屏幕上（安卓要求常驻服务必须显示一条通知）。
 */
class PetService : Service() {
    private val app get() = App.instance
    private val prefs get() = app.prefs
    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var controller: PetController? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var screenOn = true

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            screenOn = intent.action != Intent.ACTION_SCREEN_OFF
            controller?.setScreenOn(screenOn)
        }
    }

    private val prefListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        when (key) {
            "color", "scale", "pet_name" -> {
                controller?.applyAppearance()
                updateNotification()
            }
            "tts" -> if (prefs.tts) initTts()
        }
    }

    private val proactiveTick = object : Runnable {
        override fun run() {
            scheduleProactive()
            val c = controller ?: return
            if (!prefs.proactive || !c.attached || !screenOn || c.isChatOpen || c.isSleeping) return
            app.chat.proactive(prefs.proactiveAi)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startAsForeground()
        isRunning = true
        val themed = ContextThemeWrapper(this, R.style.Theme_AiPet)
        controller = PetController(themed, prefs) { openSettings() }
        screenOn = getSystemService(PowerManager::class.java)?.isInteractive ?: true
        ContextCompat.registerReceiver(
            this, screenReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        prefs.sp.registerOnSharedPreferenceChangeListener(prefListener)
        if (prefs.tts) initTts()
        scope.launch { app.chat.events.collect { onChatEvent(it) } }
        scheduleProactive()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                prefs.petEnabled = false
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_HIDE -> hidePet()
            ACTION_TOGGLE -> if (controller?.attached == true) hidePet() else showPet()
            ACTION_CHAT -> {
                showPet()
                controller?.openChat()
            }
            else -> showPet()
        }
        return START_STICKY
    }

    private fun showPet() {
        if (!Overlay.canDraw(this)) {
            Toast.makeText(this, "需要先允许“显示在其他应用上层”权限", Toast.LENGTH_LONG).show()
            openSettings()
            stopSelf()
            return
        }
        prefs.petEnabled = true
        try {
            controller?.show()
        } catch (e: Exception) {
            Log.e(TAG, "show failed", e)
            Toast.makeText(this, "桌宠出不来：${e.message}", Toast.LENGTH_LONG).show()
        }
        visible.value = controller?.attached == true
        updateNotification()
    }

    private fun hidePet() {
        controller?.hide()
        visible.value = false
        updateNotification()
    }

    private fun onChatEvent(ev: PetEvent) {
        val c = controller ?: return
        when (ev) {
            PetEvent.Thinking -> c.setMode(PetView.Mode.THINKING)
            is PetEvent.Streaming -> {
                c.setMode(PetView.Mode.TALKING)
                if (!c.isChatOpen) c.sayStreaming(ev.textSoFar)
            }
            is PetEvent.Said -> {
                c.touchInteraction()
                if (c.isSleeping) c.setMode(PetView.Mode.IDLE)
                c.setMode(PetView.Mode.TALKING)
                val dur = PetController.autoDuration(ev.text)
                if (!c.isChatOpen) c.say(ev.text, dur)
                handler.postDelayed({
                    if (c.view.baseMode == PetView.Mode.TALKING) c.setMode(PetView.Mode.IDLE)
                }, dur.coerceAtMost(5000))
                if (ev.speak && prefs.tts) speak(ev.text)
            }
            is PetEvent.Failed -> {
                c.setMode(PetView.Mode.IDLE)
                if (!c.isChatOpen) c.say("呜……出错了，点我看看怎么回事", 5000)
            }
        }
    }

    private fun scheduleProactive() {
        handler.removeCallbacks(proactiveTick)
        val minutes = Random.nextLong(25, 46)
        handler.postDelayed(proactiveTick, minutes * 60_000L)
    }

    // ---------------- 朗读 ----------------

    private fun initTts() {
        if (tts != null) return
        tts = TextToSpeech(applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.CHINESE
        }
    }

    private fun speak(text: String) {
        if (!ttsReady) {
            initTts()
            return
        }
        // 颜文字读出来很奇怪，去掉
        val clean = text.replace(Regex("""[（(][^（()）]{0,12}[)）]"""), " ")
            .replace(Regex("""[^\p{IsHan}\p{L}\p{N}，。！？、,.!?…～~\s]"""), "")
        if (clean.isNotBlank()) tts?.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "pet")
    }

    // ---------------- 通知 ----------------

    private fun startAsForeground() {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
    }

    private fun updateNotification() {
        try {
            val nm = getSystemService(android.app.NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, buildNotification())
        } catch (_: SecurityException) {
        }
    }

    private fun buildNotification(): Notification {
        val visible = controller?.attached == true
        val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        fun service(action: String, code: Int) = PendingIntent.getService(
            this, code, Intent(this, PetService::class.java).setAction(action), immutable,
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), immutable,
        )
        val name = prefs.petName
        return NotificationCompat.Builder(this, App.CHANNEL_PET)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (visible) "${name}正在陪着你" else "${name}在休息（已收起）")
            .setContentText("点这里打开设置")
            .setContentIntent(open)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "聊天", service(ACTION_CHAT, 1))
            .addAction(0, if (visible) "收起" else "叫出来", service(ACTION_TOGGLE, 2))
            .addAction(0, "退出", service(ACTION_STOP, 3))
            .build()
    }

    private fun openSettings() {
        try {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            Log.w(TAG, "cannot open settings", e)
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        controller?.onConfigurationChanged()
    }

    override fun onDestroy() {
        isRunning = false
        visible.value = false
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        prefs.sp.unregisterOnSharedPreferenceChangeListener(prefListener)
        try {
            unregisterReceiver(screenReceiver)
        } catch (_: Exception) {
        }
        controller?.hide()
        controller = null
        tts?.shutdown()
        tts = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "PetService"
        private const val NOTIFICATION_ID = 1
        const val ACTION_SHOW = "show"
        const val ACTION_HIDE = "hide"
        const val ACTION_TOGGLE = "toggle"
        const val ACTION_CHAT = "chat"
        const val ACTION_STOP = "stop"

        @Volatile
        var isRunning = false
            private set

        /** 桌宠现在是不是在屏幕上（设置页的“让它出来/收起它”按钮用） */
        val visible = MutableStateFlow(false)

        fun start(context: Context, action: String = ACTION_SHOW) {
            ContextCompat.startForegroundService(context, Intent(context, PetService::class.java).setAction(action))
        }
    }
}
