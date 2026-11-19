package io.github.callaumyan.aipet.pet

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import io.github.callaumyan.aipet.Prefs
import io.github.callaumyan.aipet.chat.Persona
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.random.Random

/**
 * 管理屏幕上的桌宠：显示/隐藏、拖动、自己溜达、困了睡觉、头顶冒气泡、打开聊天窗口。
 */
class PetController(
    private val ctx: Context,
    private val prefs: Prefs,
    private val openSettings: () -> Unit,
) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val density = ctx.resources.displayMetrics.density
    private val touchSlop = ViewConfiguration.get(ctx).scaledTouchSlop

    val view = PetView(ctx)
    private val params = Overlay.baseParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, focusable = false,
    )
    private val bubble = BubbleWindow(ctx, wm) { openChat() }
    private val chatPanel = ChatPanel(ctx, wm, openSettings) { onChatClosed() }

    var attached = false
        private set
    private var hiddenForChat = false

    private var lastInteraction = SystemClock.uptimeMillis()
    private var nextWalkAt = SystemClock.uptimeMillis() + 6_000
    private var walking = false
    private var walkTargetX = 0
    private var walkLastTick = 0L
    private var dragging = false

    val isChatOpen get() = chatPanel.isShowing
    val isSleeping get() = view.baseMode == PetView.Mode.SLEEP

    init {
        applyAppearance()
        setupTouch()
    }

    fun applyAppearance() {
        view.palette = PetPalette.get(prefs.colorIndex)
        view.bodySize = 72 * density * prefs.scalePercent / 100f
        view.contentDescription = prefs.petName
        if (attached) {
            view.measure(0, 0)
            clampAndUpdate()
        }
    }

    fun show() {
        if (attached) return
        val screen = Overlay.screenSize(wm)
        view.measure(0, 0)
        val w = view.measuredWidth
        val h = view.measuredHeight
        params.x = if (prefs.petX >= 0) prefs.petX else screen.x - w - (8 * density).toInt()
        params.y = if (prefs.petY >= 0) prefs.petY else (screen.y * 0.62f).toInt() - h / 2
        clampParams(w, h)
        try {
            wm.addView(view, params)
            attached = true
        } catch (e: Exception) {
            attached = false
            throw e
        }
        view.running = true
        lastInteraction = SystemClock.uptimeMillis()
        handler.removeCallbacks(brainTick)
        handler.postDelayed(brainTick, 1000)
        view.flash(PetView.Mode.HAPPY, 1500)
        handler.postDelayed({ say(Persona.greetings(prefs.petName).random(), 3500) }, 400)
    }

    fun hide() {
        handler.removeCallbacks(brainTick)
        handler.removeCallbacks(walkTick)
        walking = false
        bubble.hide()
        chatPanel.dismiss()
        if (attached) {
            view.running = false
            try {
                wm.removeView(view)
            } catch (_: Exception) {
            }
            attached = false
        }
    }

    fun setScreenOn(on: Boolean) {
        view.running = on && attached
        if (!on) stopWalking()
    }

    fun petBounds(): Rect = Rect(params.x, params.y, params.x + view.width.coerceAtLeast(view.measuredWidth),
        params.y + view.height.coerceAtLeast(view.measuredHeight))

    /** 头顶冒一句话。durationMs <= 0 表示一直显示。 */
    fun say(text: String, durationMs: Long = autoDuration(text)) {
        if (!attached || hiddenForChat) return
        bubble.show(shorten(text), petBounds(), durationMs)
    }

    fun sayStreaming(textSoFar: String) {
        if (!attached || hiddenForChat) return
        val t = textSoFar.trim()
        val shown = if (t.length > 90) "…" + t.takeLast(88) else t
        bubble.show(shown.ifEmpty { "……" }, petBounds(), 0)
    }

    fun setMode(mode: PetView.Mode) {
        if (mode != PetView.Mode.IDLE) stopWalking()
        view.baseMode = mode
    }

    fun touchInteraction() {
        lastInteraction = SystemClock.uptimeMillis()
    }

    fun openChat() {
        if (chatPanel.isShowing) return
        stopWalking()
        bubble.hide()
        hiddenForChat = true
        if (attached) {
            view.alpha = 0f
            params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            updateLayout()
        }
        chatPanel.show()
    }

    private fun onChatClosed() {
        hiddenForChat = false
        lastInteraction = SystemClock.uptimeMillis()
        if (attached) {
            view.alpha = 1f
            params.flags = params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
            updateLayout()
            view.flash(PetView.Mode.HAPPY, 900)
        }
    }

    fun onConfigurationChanged() {
        if (attached) clampAndUpdate()
        if (chatPanel.isShowing) {
            chatPanel.dismiss()
        }
    }

    // ---------------- 拖动 / 点击 / 长按 ----------------

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTouch() {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var longFired = false
        val longPress = Runnable {
            longFired = true
            onPetted()
        }
        view.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY
                    startX = params.x; startY = params.y
                    dragging = false
                    longFired = false
                    handler.postDelayed(longPress, 550)
                    touchInteraction()
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!dragging && hypot(dx, dy) > touchSlop * 1.5f) {
                        dragging = true
                        handler.removeCallbacks(longPress)
                        stopWalking()
                        view.baseMode = PetView.Mode.DRAG
                        if (Random.nextFloat() < 0.35f) say(Persona.dragging.random(), 1800)
                    }
                    if (dragging) {
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        clampAndUpdate()
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    handler.removeCallbacks(longPress)
                    if (dragging) {
                        dragging = false
                        view.baseMode = PetView.Mode.IDLE
                        view.jump()
                        prefs.petX = params.x
                        prefs.petY = params.y
                        if (Random.nextFloat() < 0.35f) say(Persona.dropped.random(), 2000)
                        nextWalkAt = SystemClock.uptimeMillis() + 8_000
                    } else if (!longFired && e.actionMasked == MotionEvent.ACTION_UP) {
                        onTapped()
                    }
                    touchInteraction()
                }
            }
            true
        }
    }

    private fun onTapped() {
        if (wakeUpIfSleeping()) return
        view.flash(PetView.Mode.HAPPY, 600)
        handler.postDelayed({ openChat() }, 180)
    }

    private fun onPetted() {
        wakeUpIfSleeping()
        stopWalking()
        view.flash(PetView.Mode.HAPPY, 2200)
        view.hearts(4)
        say(Persona.petting.random(), 2200)
    }

    private fun wakeUpIfSleeping(): Boolean {
        if (view.baseMode != PetView.Mode.SLEEP) return false
        view.baseMode = PetView.Mode.IDLE
        view.jump()
        say(Persona.waking.random(), 2500)
        lastInteraction = SystemClock.uptimeMillis()
        return true
    }

    // ---------------- 自主行为：溜达、犯困 ----------------

    private val brainTick: Runnable = object : Runnable {
        override fun run() {
            if (!attached) return
            handler.postDelayed(this, 1000)
            if (dragging || hiddenForChat || !view.running) return
            val now = SystemClock.uptimeMillis()
            val idleFor = now - lastInteraction
            val mode = view.baseMode
            if (mode == PetView.Mode.SLEEP || mode == PetView.Mode.THINKING || mode == PetView.Mode.TALKING) return
            val sleepAfter = if (Persona.isNight()) 3 * 60_000L else 12 * 60_000L
            if (idleFor > sleepAfter && !bubble.isShowing) {
                stopWalking()
                view.baseMode = PetView.Mode.SLEEP
                return
            }
            if (prefs.wander && !walking && mode == PetView.Mode.IDLE && now > nextWalkAt && !bubble.isShowing) {
                startWalk()
            }
        }
    }

    private fun startWalk() {
        val screen = Overlay.screenSize(wm)
        val w = view.width.coerceAtLeast(view.measuredWidth)
        val range = (screen.x * 0.35f).toInt()
        var target = params.x + Random.nextInt(-range, range + 1)
        target = target.coerceIn(0, (screen.x - w).coerceAtLeast(0))
        if (abs(target - params.x) < 40 * density) {
            nextWalkAt = SystemClock.uptimeMillis() + 5_000
            return
        }
        walkTargetX = target
        view.facing = if (target > params.x) 1 else -1
        view.baseMode = PetView.Mode.WALK
        walking = true
        walkLastTick = SystemClock.uptimeMillis()
        handler.removeCallbacks(walkTick)
        handler.post(walkTick)
    }

    private fun stopWalking() {
        if (!walking) return
        walking = false
        handler.removeCallbacks(walkTick)
        if (view.baseMode == PetView.Mode.WALK) view.baseMode = PetView.Mode.IDLE
        nextWalkAt = SystemClock.uptimeMillis() + Random.nextLong(10_000, 25_000)
    }

    private val walkTick: Runnable = object : Runnable {
        override fun run() {
            if (!walking || !attached) return
            val now = SystemClock.uptimeMillis()
            val dt = (now - walkLastTick).coerceIn(0, 100) / 1000f
            walkLastTick = now
            val speed = view.bodySize * 0.9f // 像素/秒
            val step = (speed * dt).toInt().coerceAtLeast(1)
            val remaining = walkTargetX - params.x
            if (abs(remaining) <= step) {
                params.x = walkTargetX
                updateLayout()
                stopWalking()
                return
            }
            params.x += if (remaining > 0) step else -step
            updateLayout()
            handler.postDelayed(this, 33)
        }
    }

    // ---------------- 窗口位置 ----------------

    private fun clampParams(w: Int, h: Int) {
        val screen = Overlay.screenSize(wm)
        params.x = params.x.coerceIn(0, (screen.x - w).coerceAtLeast(0))
        params.y = params.y.coerceIn(0, (screen.y - h).coerceAtLeast(0))
    }

    private fun clampAndUpdate() {
        clampParams(view.width.coerceAtLeast(view.measuredWidth), view.height.coerceAtLeast(view.measuredHeight))
        updateLayout()
    }

    private fun updateLayout() {
        if (!attached) return
        try {
            wm.updateViewLayout(view, params)
        } catch (_: Exception) {
        }
        bubble.follow(petBounds())
    }

    companion object {
        fun autoDuration(text: String): Long = (2500L + text.length * 160L).coerceIn(3000L, 12000L)

        fun shorten(text: String): String {
            val t = text.trim()
            return if (t.length > 120) t.take(110) + "…（点我看全部）" else t
        }
    }
}
