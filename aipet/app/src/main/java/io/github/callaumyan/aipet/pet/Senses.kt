package io.github.callaumyan.aipet.pet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import android.view.WindowManager
import androidx.core.content.ContextCompat
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * 让桌宠“感觉到”手机发生的事：亮屏/解锁、充电/电量、耳机、正在放音乐、摇晃和倾斜。
 * 不需要任何额外权限。
 */
class Senses(private val ctx: Context, private val listener: Listener) {
    interface Listener {
        fun onScreenOff()
        fun onScreenOn(awayMs: Long)
        fun onUnlock(awayMs: Long)
        fun onCharging(on: Boolean, level: Int)
        fun onBatteryLevel(level: Int, charging: Boolean)
        fun onHeadset(on: Boolean)
        fun onMusic(on: Boolean)
        fun onShake()
        /** 沿屏幕横向的倾斜加速度（m/s²，正数 = 右边低），没倾斜时是 0 */
        fun onTilt(accel: Float)
    }

    private val handler = Handler(Looper.getMainLooper())
    private val audio = ctx.getSystemService(AudioManager::class.java)
    private val sensors = ctx.getSystemService(SensorManager::class.java)
    private val wm = ctx.getSystemService(WindowManager::class.java)

    private var screenOffAt = 0L
    private var lastAway = 0L
    private var charging: Boolean? = null
    private var level = -1
    private var music = false
    var motionEnabled = true
        set(v) {
            field = v
            updateMotion()
        }
    private var screenOn = true
    private var motionRegistered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    screenOn = false
                    screenOffAt = SystemClock.elapsedRealtime()
                    updateMotion()
                    listener.onScreenOff()
                }
                Intent.ACTION_SCREEN_ON -> {
                    screenOn = true
                    lastAway = if (screenOffAt == 0L) 0L else SystemClock.elapsedRealtime() - screenOffAt
                    updateMotion()
                    listener.onScreenOn(lastAway)
                }
                Intent.ACTION_USER_PRESENT -> listener.onUnlock(lastAway)
                Intent.ACTION_BATTERY_CHANGED -> onBattery(intent)
                Intent.ACTION_HEADSET_PLUG -> {
                    if (!isInitialStickyBroadcast) listener.onHeadset(intent.getIntExtra("state", 0) == 1)
                }
            }
        }
    }

    private val musicPoll = object : Runnable {
        override fun run() {
            handler.postDelayed(this, 4_000)
            if (!screenOn) return
            val now = try { audio?.isMusicActive == true } catch (_: Exception) { false }
            if (now != music) {
                music = now
                listener.onMusic(now)
            }
        }
    }

    fun start() {
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_HEADSET_PLUG)
        }
        ContextCompat.registerReceiver(ctx, receiver, f, ContextCompat.RECEIVER_NOT_EXPORTED)
        handler.postDelayed(musicPoll, 4_000)
        updateMotion()
    }

    fun stop() {
        try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}
        handler.removeCallbacksAndMessages(null)
        if (motionRegistered) sensors?.unregisterListener(motion)
        motionRegistered = false
    }

    private fun onBattery(intent: Intent) {
        val lvl = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
        val pct = if (lvl < 0) 100 else lvl * 100 / scale
        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        val prev = charging
        charging = plugged
        if (prev != null && prev != plugged) listener.onCharging(plugged, pct)
        if (pct != level) {
            level = pct
            listener.onBatteryLevel(pct, plugged)
        }
    }

    // ---------------- 摇晃 / 倾斜 ----------------

    private fun updateMotion() {
        val want = motionEnabled && screenOn
        val acc = sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        if (want && !motionRegistered) {
            motionRegistered = sensors.registerListener(motion, acc, SensorManager.SENSOR_DELAY_UI)
        } else if (!want && motionRegistered) {
            sensors.unregisterListener(motion)
            motionRegistered = false
            listener.onTilt(0f)
        }
    }

    private val motion = object : SensorEventListener {
        private val g = FloatArray(3)
        private var init = false
        private val peaks = ArrayDeque<Long>()
        private var lastShake = 0L
        private var lastTilt = 0f

        override fun onSensorChanged(e: SensorEvent) {
            val x = e.values[0]; val y = e.values[1]; val z = e.values[2]
            if (!init) { g[0] = x; g[1] = y; g[2] = z; init = true }
            val a = 0.85f
            g[0] = a * g[0] + (1 - a) * x
            g[1] = a * g[1] + (1 - a) * y
            g[2] = a * g[2] + (1 - a) * z
            val lx = x - g[0]; val ly = y - g[1]; val lz = z - g[2]
            val lin = sqrt(lx * lx + ly * ly + lz * lz)
            val now = SystemClock.elapsedRealtime()
            if (lin > 13f) {
                if (peaks.isEmpty() || now - peaks.last() > 90) peaks.addLast(now)
                while (peaks.isNotEmpty() && now - peaks.first() > 900) peaks.removeFirst()
                if (peaks.size >= 3 && now - lastShake > 2_500) {
                    lastShake = now
                    peaks.clear()
                    listener.onShake()
                }
            }
            // 倾斜：只在竖屏时用，把重力换算到屏幕横向
            val rot = try { @Suppress("DEPRECATION") wm?.defaultDisplay?.rotation ?: Surface.ROTATION_0 } catch (_: Exception) { Surface.ROTATION_0 }
            val side = if (rot == Surface.ROTATION_0) -g[0] else 0f
            val tilt = if (abs(side) > 3.2f && lin < 6f) side else 0f
            if ((tilt == 0f) != (lastTilt == 0f) || abs(tilt - lastTilt) > 0.8f) {
                lastTilt = tilt
                listener.onTilt(tilt)
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }
}
