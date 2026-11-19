package io.github.callaumyan.aipet.pet

import kotlin.math.abs
import kotlin.math.hypot

/**
 * 把手指在桌宠身上的动作分成几类：
 * - 点一下 / 连点（count = 连续第几下）
 * - 按住不动一小会儿 → 拎起来（之后跟着手指走，松手按手指速度扔出去；没挪动就松开 = 打开菜单）
 * - 在它身上来回蹭 → 摸摸（每次换方向算一下）
 * - 快速划一下 → 推它
 *
 * 不依赖安卓，时间和坐标都由外面传进来，方便测试。
 */
class PetGestures(
    private val cb: Callback,
    private val slopPx: Float,
    private val holdMs: Long = 260,
    private val multiTapMs: Long = 380,
) {
    interface Callback {
        fun onTap(localX: Float, localY: Float, count: Int)
        fun onPickUp()
        fun onDrag(dxRaw: Float, dyRaw: Float)
        /** 松手。movedPx：拎起来后手指一共挪了多远（几乎没动 = 按住再松开，用来打开菜单） */
        fun onRelease(vx: Float, vy: Float, movedPx: Float)
        fun onStroke(strokes: Int)
        fun onStrokeEnd(strokes: Int)
        fun onFlick(vx: Float, vy: Float)
    }

    private enum class State { IDLE, PENDING, DRAGGING, STROKING }

    private var state = State.IDLE
    private var downT = 0L
    private var downRawX = 0f
    private var downRawY = 0f
    private var downLocalX = 0f
    private var downLocalY = 0f

    private var lastTapT = -10_000L
    private var lastTapX = 0f
    private var lastTapY = 0f
    private var tapCount = 0

    // 摸摸：记录水平方向的来回
    private var strokeDir = 0
    private var strokeAnchor = 0f
    private var strokes = 0

    private val ts = LongArray(8)
    private val xs = FloatArray(8)
    private val ys = FloatArray(8)
    private var n = 0

    val isDragging get() = state == State.DRAGGING

    private fun record(t: Long, x: Float, y: Float) {
        val i = n % ts.size
        ts[i] = t; xs[i] = x; ys[i] = y
        n++
    }

    /** 最近 ~100ms 的手指速度（像素/秒） */
    private fun velocity(now: Long): Pair<Float, Float> {
        if (n < 2) return 0f to 0f
        val last = (n - 1) % ts.size
        var first = last
        var k = 1
        while (k < minOf(n, ts.size)) {
            val i = (n - 1 - k) % ts.size
            if (now - ts[i] > 100) break
            first = i
            k++
        }
        if (first == last) {
            // 只有一个点在窗口内：用前一个点
            first = (n - 2) % ts.size
        }
        val dt = (ts[last] - ts[first]).coerceAtLeast(8) / 1000f
        return (xs[last] - xs[first]) / dt to (ys[last] - ys[first]) / dt
    }

    fun down(t: Long, localX: Float, localY: Float, rawX: Float, rawY: Float) {
        state = State.PENDING
        downT = t
        downRawX = rawX; downRawY = rawY
        downLocalX = localX; downLocalY = localY
        n = 0
        record(t, rawX, rawY)
        strokes = 0
        strokeDir = 0
        strokeAnchor = rawX
    }

    /** 外面定时调用（按下后 holdMs 左右），用来判断“按住不动 = 拎起来” */
    fun tick(t: Long) {
        if (state == State.PENDING && t - downT >= holdMs) {
            state = State.DRAGGING
            cb.onPickUp()
        }
    }

    fun move(t: Long, rawX: Float, rawY: Float) {
        record(t, rawX, rawY)
        when (state) {
            State.PENDING -> {
                if (t - downT >= holdMs) {
                    state = State.DRAGGING
                    cb.onPickUp()
                    cb.onDrag(rawX - downRawX, rawY - downRawY)
                } else if (hypot(rawX - downRawX, rawY - downRawY) > slopPx) {
                    state = State.STROKING
                    strokeDir = if (rawX >= downRawX) 1 else -1
                    strokeAnchor = rawX
                }
            }
            State.DRAGGING -> cb.onDrag(rawX - downRawX, rawY - downRawY)
            State.STROKING -> {
                val d = rawX - strokeAnchor
                if (strokeDir > 0) {
                    if (rawX > strokeAnchor) strokeAnchor = rawX
                    else if (-d > slopPx * 0.8f) {
                        strokeDir = -1; strokeAnchor = rawX; strokes++; cb.onStroke(strokes)
                    }
                } else {
                    if (rawX < strokeAnchor) strokeAnchor = rawX
                    else if (d > slopPx * 0.8f) {
                        strokeDir = 1; strokeAnchor = rawX; strokes++; cb.onStroke(strokes)
                    }
                }
            }
            State.IDLE -> Unit
        }
    }

    fun up(t: Long, rawX: Float, rawY: Float) {
        record(t, rawX, rawY)
        when (state) {
            State.PENDING -> {
                val near = hypot(downLocalX - lastTapX, downLocalY - lastTapY) < slopPx * 6
                tapCount = if (t - lastTapT <= multiTapMs && near) tapCount + 1 else 1
                lastTapT = t
                lastTapX = downLocalX; lastTapY = downLocalY
                cb.onTap(downLocalX, downLocalY, tapCount)
            }
            State.DRAGGING -> {
                val (vx, vy) = velocity(t)
                cb.onRelease(vx, vy, hypot(rawX - downRawX, rawY - downRawY))
            }
            State.STROKING -> {
                if (strokes >= 1) cb.onStrokeEnd(strokes)
                else {
                    val (vx, vy) = velocity(t)
                    if (hypot(vx, vy) > slopPx * 40) cb.onFlick(vx, vy)
                }
            }
            State.IDLE -> Unit
        }
        state = State.IDLE
    }

    fun cancel() {
        if (state == State.DRAGGING) cb.onRelease(0f, 0f, slopPx * 10)
        if (state == State.STROKING && strokes >= 1) cb.onStrokeEnd(strokes)
        state = State.IDLE
    }

    companion object {
        /**
         * 点到的位置在身体的哪个部位。footX/footY 是身体底部中点（View 内坐标），s 是身体尺寸。
         */
        fun zoneOf(localX: Float, localY: Float, footX: Float, footY: Float, s: Float): Zone {
            val up = (footY - localY) / s
            val side = abs(localX - footX) / s
            return when {
                up > 0.8f && side < 0.2f -> Zone.SPROUT
                up > 0.58f -> Zone.HEAD
                up > 0.24f -> Zone.FACE
                else -> Zone.BELLY
            }
        }
    }
}
