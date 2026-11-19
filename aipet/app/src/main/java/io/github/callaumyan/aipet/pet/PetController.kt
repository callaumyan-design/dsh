package io.github.callaumyan.aipet.pet

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import io.github.callaumyan.aipet.Prefs
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sign
import kotlin.random.Random

/**
 * 屏幕上的桌宠：把“身体”（物理）、“大脑”（性格和反应）、“感官”（手机状态）、手势、
 * 头顶气泡、菜单、零食和聊天窗口连在一起。
 */
class PetController(
    private val ctx: Context,
    private val prefs: Prefs,
    private val openSettings: () -> Unit,
    private val requestHide: () -> Unit,
) : PetActor, Senses.Listener {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val density = ctx.resources.displayMetrics.density
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop.toFloat()

    val view = PetView(ctx)
    private val params = Overlay.baseParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, focusable = false,
    ).apply { flags = flags or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS }

    private val physics = PetPhysics(density)
    val brain = PetBrain(
        actor = this, memory = prefs.memory, lines = Lines(),
        clock = { SystemClock.uptimeMillis() },
        hourOfDay = { Calendar.getInstance().get(Calendar.HOUR_OF_DAY) },
    )
    private val senses = Senses(ctx, this)
    private val bubble = BubbleWindow(ctx, wm) { openChat() }
    private val menu = MenuWindow(ctx, wm)
    private val food = FoodWindow(ctx, wm)
    private val chatPanel = ChatPanel(ctx, wm, openSettings) { onChatClosed() }

    var attached = false
        private set
    private var hiddenForChat = false
    private var screenOn = true
    private var rest = Pose.STAND
    private var pendingWall: Boolean? = null

    val isChatOpen get() = chatPanel.isShowing
    val isSleeping get() = brain.asleep

    init {
        brain.restore(prefs.savedMood, prefs.savedEnergy)
        applyAppearance()
        setupTouch()
        senses.motionEnabled = prefs.senseMotion
        senses.start()
    }

    fun applyAppearance() {
        view.palette = PetPalette.get(prefs.colorIndex)
        view.bodySize = 72 * density * prefs.scalePercent / 100f
        view.contentDescription = prefs.petName
        physics.gravityOn = prefs.gravity
        senses.motionEnabled = prefs.senseMotion
        view.measure(0, 0)
        updateBounds()
        if (attached) {
            physics.clamp()
            if (!prefs.gravity && physics.surface != PetPhysics.Surface.HELD) {
                physics.place(physics.x, physics.y, PetPhysics.Surface.FLOAT)
            } else if (prefs.gravity && physics.surface == PetPhysics.Surface.FLOAT) {
                physics.release(0f, 0f)
            }
            syncWindow()
            ensureLoop()
        }
    }

    // ---------------- 显示 / 隐藏 ----------------

    fun show() {
        if (attached) return
        view.measure(0, 0)
        updateBounds()
        restorePosition()
        params.x = physics.x.toInt()
        params.y = physics.y.toInt()
        wm.addView(view, params)
        attached = true
        view.running = screenOn
        syncPose()
        startTicks()
        brain.onPlaced()
        brain.onShown()
        ensureLoop()
    }

    fun hide() {
        stopTicks()
        savePosition()
        bubble.hide()
        menu.hide()
        food.remove()
        chatPanel.dismiss()
        if (attached) {
            view.running = false
            try { wm.removeView(view) } catch (_: Exception) {}
            attached = false
        }
    }

    fun destroy() {
        hide()
        senses.stop()
        saveState()
    }

    fun saveState() {
        prefs.savedMood = brain.mood
        prefs.savedEnergy = brain.energy
    }

    private fun restorePosition() {
        val sx = prefs.petX.takeIf { it != -1 }?.toFloat() ?: physics.maxX
        val sy = prefs.petY.takeIf { it != -1 }?.toFloat() ?: physics.floorY
        val surf = when {
            !prefs.gravity -> PetPhysics.Surface.FLOAT
            prefs.petSurface == 1 -> PetPhysics.Surface.WALL_LEFT
            prefs.petSurface == 2 -> PetPhysics.Surface.WALL_RIGHT
            else -> PetPhysics.Surface.FLOOR
        }
        physics.place(sx, sy, surf)
    }

    private fun savePosition() {
        prefs.petX = physics.x.toInt()
        prefs.petY = physics.y.toInt()
        prefs.petSurface = when (physics.surface) {
            PetPhysics.Surface.WALL_LEFT -> 1
            PetPhysics.Surface.WALL_RIGHT -> 2
            PetPhysics.Surface.FLOAT -> 3
            else -> 0
        }
    }

    /** 根据屏幕和桌宠大小算出能去的范围 */
    private fun updateBounds() {
        val screen = Overlay.screenSize(wm)
        val s = view.bodySize
        val w = view.measuredWidth.toFloat()
        val h = view.measuredHeight.toFloat()
        val floorBottom = screen.y - navBarHeight()
        physics.minX = -0.25f * s
        physics.maxX = screen.x - w + 0.25f * s
        physics.floorY = floorBottom - (h - 0.085f * s)
        physics.minY = Overlay.statusBarHeight(ctx) - 0.25f * s
        physics.clingLeftX = -(w / 2f - 0.445f * s)
        physics.clingRightX = screen.x - w + (w / 2f - 0.445f * s)
    }

    private fun navBarHeight(): Int {
        val id = ctx.resources.getIdentifier("navigation_bar_height", "dimen", "android")
        return if (id > 0) ctx.resources.getDimensionPixelSize(id) else 0
    }

    fun onConfigurationChanged() {
        view.measure(0, 0)
        updateBounds()
        if (physics.surface == PetPhysics.Surface.HELD) physics.release(0f, 0f)
        physics.clamp()
        if (attached) syncWindow()
        if (chatPanel.isShowing) chatPanel.dismiss()
        menu.hide()
    }

    // ---------------- 每帧：物理 → 窗口位置 ----------------

    private var loopPosted = false
    private var lastFrameNanos = 0L

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(nanos: Long) {
            loopPosted = false
            if (!attached) return
            val dt = if (lastFrameNanos == 0L) 0.016f else (nanos - lastFrameNanos) / 1e9f
            lastFrameNanos = nanos
            val events = physics.step(dt)
            for (e in events) onPhysicsEvent(e)
            syncWindow()
            syncPose()
            if (!physics.isSettled || gestures.isDragging) ensureLoop() else lastFrameNanos = 0L
        }
    }

    private fun ensureLoop() {
        if (loopPosted || !attached) return
        loopPosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun syncWindow() {
        if (!attached) return
        val nx = physics.x.toInt()
        val ny = physics.y.toInt()
        if (nx != params.x || ny != params.y) {
            params.x = nx
            params.y = ny
            try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
            bubble.follow(petBounds())
            if (menu.isShowing && !gestures.isDragging) menu.hide()
        }
    }

    /** 身体姿势：在空中/墙上/被拎着时由物理决定，否则用大脑给的姿势 */
    private fun syncPose() {
        view.velX = physics.vx
        view.velY = physics.vy
        when (physics.surface) {
            PetPhysics.Surface.HELD -> { view.pose = Pose.HELD; view.moving = false }
            PetPhysics.Surface.AIR -> { view.pose = Pose.AIR; view.moving = false }
            PetPhysics.Surface.WALL_LEFT -> { view.pose = Pose.CLING_LEFT; view.moving = physics.climbDir != 0 }
            PetPhysics.Surface.WALL_RIGHT -> { view.pose = Pose.CLING_RIGHT; view.moving = physics.climbDir != 0 }
            PetPhysics.Surface.FLOOR, PetPhysics.Surface.FLOAT -> {
                val walking = physics.walkTargetX != null || (physics.surface == PetPhysics.Surface.FLOOR && abs(physics.vx) > 40 * density)
                if (walking) {
                    view.pose = Pose.WALK
                    if (abs(physics.vx) > 1f) view.facing = sign(physics.vx).toInt()
                } else {
                    view.pose = rest
                }
                view.moving = false
            }
        }
    }

    private fun onPhysicsEvent(e: PetPhysics.Event) {
        when (e) {
            is PetPhysics.Event.Landed -> {
                view.impulse((e.speedDp / 260f).coerceAtMost(6f), 0f)
                view.spinSpeed = 0f
                brain.onLanded(e.speedDp, e.bounced)
                if (!e.bounced) savePosition()
            }
            is PetPhysics.Event.HitWall -> {
                view.impulse(1f, (if (e.left) 1f else -1f) * (e.speedDp / 15f).coerceAtMost(160f))
                brain.onHitWall(e.speedDp)
            }
            is PetPhysics.Event.StuckToWall -> {
                view.impulse(3f, 0f)
                view.spinSpeed = 0f
                brain.onStuckToWall()
                savePosition()
            }
            is PetPhysics.Event.HitCeiling -> view.impulse(-2f, 0f)
            PetPhysics.Event.ArrivedAtTarget -> {
                val wall = pendingWall
                if (wall != null && physics.surface == PetPhysics.Surface.FLOOR) {
                    pendingWall = null
                    physics.stickToWall(wall)
                    view.impulse(2f, 0f)
                    climb(-1)
                    handler.postDelayed({ climb(0) }, Random.nextLong(1_200, 3_200))
                }
                savePosition()
            }
            PetPhysics.Event.StoppedFloating -> {
                brain.onStoppedFloating()
                savePosition()
            }
        }
    }

    // ---------------- 大脑的节拍 ----------------

    private val tick = object : Runnable {
        private var n = 0
        override fun run() {
            handler.postDelayed(this, 250)
            if (!attached || !screenOn || hiddenForChat) return
            brain.tick()
            if (!physics.isSettled) ensureLoop()
            if (++n % 20 == 0) {
                PetService.status.value = brain.snapshot()
            }
            if (n % 240 == 0) saveState()
        }
    }

    private fun startTicks() {
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    private fun stopTicks() {
        handler.removeCallbacks(tick)
    }

    // ---------------- 手势 ----------------

    private var dragStartX = 0f
    private var dragStartY = 0f
    private var lastDragT = 0L
    private var lastDragX = 0f
    private var shakeScore = 0f
    private var surfaceBeforePickup = PetPhysics.Surface.FLOOR
    private var posBeforePickupX = 0f
    private var posBeforePickupY = 0f

    private val gestures = PetGestures(object : PetGestures.Callback {
        override fun onTap(localX: Float, localY: Float, count: Int) {
            view.pokeAt(localX, localY)
            val zone = when (view.pose) {
                Pose.STAND, Pose.WALK, Pose.SIT, Pose.DANCE, Pose.LIE ->
                    PetGestures.zoneOf(localX, localY, view.footX, view.footY, view.bodySize)
                else -> Zone.FACE
            }
            menu.hide()
            brain.onTap(zone, count)
        }

        override fun onPickUp() {
            surfaceBeforePickup = physics.surface
            posBeforePickupX = physics.x
            posBeforePickupY = physics.y
            physics.grab()
            pendingWall = null
            dragStartX = physics.x
            dragStartY = physics.y - 10 * density
            physics.dragTo(dragStartX, dragStartY)
            lastDragT = SystemClock.uptimeMillis()
            lastDragX = dragStartX
            shakeScore = 0f
            bubble.hide()
            menu.hide()
            view.impulse(-3f, 0f)
            brain.onPickUp()
            syncPose()
            ensureLoop()
        }

        override fun onDrag(dxRaw: Float, dyRaw: Float) {
            val nx = dragStartX + dxRaw
            val ny = dragStartY + dyRaw
            val now = SystemClock.uptimeMillis()
            val dt = ((now - lastDragT).coerceAtLeast(1)) / 1000f
            val vx = (nx - lastDragX) / dt
            lastDragT = now
            lastDragX = nx
            view.velX = vx
            // 拎着甩来甩去会晕
            shakeScore = (shakeScore * 0.9f + if (abs(vx) > 2500 * density) 1f else 0f)
            if (shakeScore > 4f) {
                shakeScore = 0f
                brain.onShakenWhileHeld()
            }
            physics.dragTo(nx, ny)
            syncWindow()
        }

        override fun onRelease(vx: Float, vy: Float, movedPx: Float) {
            if (movedPx < slop * 2) {
                // 按住又松开：放回原处，打开菜单
                physics.place(posBeforePickupX, posBeforePickupY, surfaceBeforePickup.takeIf { it != PetPhysics.Surface.AIR && it != PetPhysics.Surface.HELD } ?: PetPhysics.Surface.FLOOR)
                if (surfaceBeforePickup == PetPhysics.Surface.AIR) physics.release(0f, 0f)
                brain.onRelease(0f)
                syncWindow(); syncPose()
                ensureLoop()
                openMenu()
                return
            }
            physics.release(vx, vy)
            val speedDp = hypot(vx, vy) / density
            view.spinSpeed = if (speedDp > 1500f) (vx / density) * 0.25f else 0f
            brain.onRelease(speedDp)
            syncPose()
            ensureLoop()
        }

        override fun onStroke(strokes: Int) {
            view.impulse(1.2f, if (strokes % 2 == 0) 50f else -50f)
            brain.onStroke(strokes)
        }

        override fun onStrokeEnd(strokes: Int) = brain.onStrokeEnd(strokes)

        override fun onFlick(vx: Float, vy: Float) {
            brain.onFlick(if (vx >= 0) 1 else -1)
        }
    }, slop)

    private val holdCheck = Runnable { gestures.tick(SystemClock.uptimeMillis()) }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTouch() {
        view.setOnTouchListener { _, e ->
            val t = SystemClock.uptimeMillis()
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    gestures.down(t, e.x, e.y, e.rawX, e.rawY)
                    handler.postDelayed(holdCheck, 270)
                }
                MotionEvent.ACTION_MOVE -> gestures.move(t, e.rawX, e.rawY)
                MotionEvent.ACTION_UP -> { handler.removeCallbacks(holdCheck); gestures.up(t, e.rawX, e.rawY) }
                MotionEvent.ACTION_CANCEL -> { handler.removeCallbacks(holdCheck); gestures.cancel() }
            }
            true
        }
    }

    // ---------------- 菜单 / 喂食 / 聊天 ----------------

    private fun openMenu() {
        brain.onMenuOpened()
        menu.show(
            listOf(
                MenuWindow.Item("🍪", "喂零食") { feed() },
                MenuWindow.Item("💬", "聊天") { openChat() },
                MenuWindow.Item("💤", "哄睡") { brain.onSleepRequested() },
                MenuWindow.Item("👋", "收起") { requestHide() },
            ),
            petBounds(),
        )
    }

    fun feed() {
        if (food.isFalling || !attached) return
        if (physics.isOnWall) physics.letGoOfWall()
        physics.stopWalking()
        brain.onFeedStart()
        ensureLoop()
        val b = petBounds()
        val mouthY = b.top + (view.footY - 0.3f * view.bodySize).toInt()
        handler.postDelayed({
            if (!attached) return@postDelayed
            val bb = petBounds()
            food.drop(bb.centerX(), bb.top + (view.footY - 0.3f * view.bodySize).toInt().coerceAtLeast(mouthY - b.top)) {
                brain.onFoodArrived()
            }
        }, 500)
    }

    fun openChat() {
        if (chatPanel.isShowing) return
        menu.hide()
        bubble.hide()
        physics.stopWalking()
        hiddenForChat = true
        if (attached) {
            view.alpha = 0f
            params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
        }
        chatPanel.show()
    }

    private fun onChatClosed() {
        hiddenForChat = false
        if (attached) {
            view.alpha = 1f
            params.flags = params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
            try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
            view.flash(Face.HAPPY, 900)
        }
    }

    fun sayStreaming(textSoFar: String) {
        if (!attached || hiddenForChat) return
        val t = textSoFar.trim()
        val shown = if (t.length > 90) "…" + t.takeLast(88) else t
        bubble.show(shown.ifEmpty { "……" }, petBounds(), 0)
    }

    fun sayLong(text: String) {
        if (!attached || hiddenForChat) return
        bubble.show(shorten(text), petBounds(), autoDuration(text))
    }

    fun petBounds(): Rect = Rect(
        params.x, params.y,
        params.x + view.width.coerceAtLeast(view.measuredWidth),
        params.y + view.height.coerceAtLeast(view.measuredHeight),
    )

    // ================= PetActor：大脑指挥身体 =================

    override fun face(face: Face) { view.face = face }
    override fun flashFace(face: Face, ms: Long) = view.flash(face, ms)
    override fun restPose(pose: Pose) { rest = pose; syncPose() }
    override fun effect(e: Effect) = view.effect(e)
    override fun say(text: String) {
        if (!attached || hiddenForChat || text.isBlank()) return
        bubble.show(text, petBounds(), autoDuration(text))
    }
    override fun lookAt(x: Float, y: Float) = view.lookAt(x, y)

    override fun walkTo(xFrac: Float, fast: Boolean) {
        if (!prefs.wander && !fast) return
        if (physics.surface != PetPhysics.Surface.FLOOR && physics.surface != PetPhysics.Surface.FLOAT) return
        rest = Pose.STAND
        physics.walkTo(physics.minX + xFrac.coerceIn(0f, 1f) * (physics.maxX - physics.minX), if (fast) 150f else 70f)
        ensureLoop()
    }

    override fun stopWalking() {
        physics.stopWalking()
        pendingWall = null
        syncPose()
    }

    override fun jump(vxDp: Float, vyDp: Float) {
        if (!prefs.gravity) { view.impulse(-3f, vxDp / 10f); return }
        when (physics.surface) {
            PetPhysics.Surface.FLOOR -> { physics.jump(vxDp, vyDp); view.impulse(-2f, 0f); ensureLoop() }
            PetPhysics.Surface.WALL_LEFT, PetPhysics.Surface.WALL_RIGHT -> view.impulse(-2f, 0f)
            else -> Unit
        }
    }

    override fun climb(dir: Int) {
        if (!physics.isOnWall) return
        physics.climbDir = dir
        physics.climbSpeed = 55f * density
        ensureLoop()
    }

    override fun letGoOfWall() {
        physics.letGoOfWall()
        ensureLoop()
    }

    override fun goToWall(left: Boolean) {
        if (!prefs.gravity || !prefs.wander || physics.surface != PetPhysics.Surface.FLOOR) return
        pendingWall = left
        rest = Pose.STAND
        physics.walkTo(if (left) physics.minX else physics.maxX, 90f)
        ensureLoop()
    }

    override fun bump(dir: Int) {
        if (prefs.gravity && physics.surface == PetPhysics.Surface.FLOOR) {
            physics.jump(dir * 320f, -260f)
        } else if (physics.surface == PetPhysics.Surface.FLOAT) {
            physics.release(dir * 600f * density, 0f)
        }
        view.impulse(1f, dir * 120f)
        ensureLoop()
    }

    override val surface: PetPhysics.Surface get() = physics.surface
    override val xFrac: Float
        get() = ((physics.x - physics.minX) / (physics.maxX - physics.minX).coerceAtLeast(1f)).coerceIn(0f, 1f)
    override val gravityOn: Boolean get() = prefs.gravity
    override val chatterAllowed: Boolean get() = prefs.proactive

    // ================= Senses：手机发生的事 =================

    override fun onScreenOff() {
        screenOn = false
        view.running = false
        brain.onScreenOff()
        menu.hide()
        bubble.hide()
        if (physics.surface == PetPhysics.Surface.AIR || physics.surface == PetPhysics.Surface.HELD) {
            physics.place(physics.x, physics.floorY, if (prefs.gravity) PetPhysics.Surface.FLOOR else PetPhysics.Surface.FLOAT)
            syncWindow()
        }
        physics.tiltAccel = 0f
        saveState()
    }

    override fun onScreenOn(awayMs: Long) {
        screenOn = true
        view.running = attached
        brain.onScreenOn(awayMs)
    }

    override fun onUnlock(awayMs: Long) {
        if (attached && !hiddenForChat) brain.onUnlock(awayMs)
    }

    override fun onCharging(on: Boolean, level: Int) {
        if (attached && !hiddenForChat) brain.onCharging(on, level) else brain.onBatteryLevel(level, on)
    }

    override fun onBatteryLevel(level: Int, charging: Boolean) = brain.onBatteryLevel(level, charging)

    override fun onHeadset(on: Boolean) {
        if (attached && !hiddenForChat) brain.onHeadset(on)
    }

    override fun onMusic(on: Boolean) {
        if (prefs.senseMusic && attached) brain.onMusic(on) else if (!on) brain.onMusic(false)
    }

    override fun onShake() {
        if (!attached || hiddenForChat || gestures.isDragging) return
        brain.onShake()
        ensureLoop()
    }

    override fun onTilt(accel: Float) {
        if (!prefs.gravity || !attached) { physics.tiltAccel = 0f; return }
        val was = physics.tiltAccel != 0f
        physics.tiltAccel = accel * 90f * density
        if (accel != 0f && physics.surface == PetPhysics.Surface.FLOOR) {
            physics.stopWalking()
            if (!was) brain.onTiltSliding()
        }
        ensureLoop()
    }

    companion object {
        fun autoDuration(text: String): Long = (2200L + text.length * 160L).coerceIn(2500L, 12000L)

        fun shorten(text: String): String {
            val t = text.trim()
            return if (t.length > 120) t.take(110) + "…（点我看全部）" else t
        }
    }
}
