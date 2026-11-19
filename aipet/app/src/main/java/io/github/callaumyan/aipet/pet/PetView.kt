package io.github.callaumyan.aipet.pet

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/** 桌宠的配色 */
data class PetPalette(val name: String, val body: Int, val bodyTop: Int, val outline: Int, val cheek: Int) {
    companion object {
        val all = listOf(
            PetPalette("奶白", 0xFFFFF4E6.toInt(), 0xFFFFFFFF.toInt(), 0xFFD2A57C.toInt(), 0xFFFFA9A9.toInt()),
            PetPalette("樱粉", 0xFFFFCFDC.toInt(), 0xFFFFE9EF.toInt(), 0xFFE0889F.toInt(), 0xFFFF7FA0.toInt()),
            PetPalette("薄荷", 0xFFC8F1E0.toInt(), 0xFFE8FBF3.toInt(), 0xFF68BE99.toInt(), 0xFFFFA2B2.toInt()),
            PetPalette("天蓝", 0xFFCFE4FF.toInt(), 0xFFEAF4FF.toInt(), 0xFF739FDB.toInt(), 0xFFFFA2BE.toInt()),
            PetPalette("柠檬", 0xFFFFEDA6.toInt(), 0xFFFFF8D8.toInt(), 0xFFD9AF3A.toInt(), 0xFFFF9C86.toInt()),
            PetPalette("香芋", 0xFFE1D4FF.toInt(), 0xFFF2ECFF.toInt(), 0xFF9C82E0.toInt(), 0xFFFF98BF.toInt()),
        )

        fun get(index: Int) = all[index.coerceIn(0, all.size - 1)]
    }
}

/**
 * 用代码画出来的桌宠“团子”：圆滚滚的身体、头顶一棵小嫩芽。
 * 只负责“画”和各种小动画（呼吸、眨眼、走路、睡觉、开心、思考、说话、被拎起来）；
 * 在屏幕上怎么移动由 [PetController] 决定。
 */
class PetView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    enum class Mode { IDLE, WALK, SLEEP, HAPPY, THINKING, TALKING, DRAG }

    /** 身体的基准尺寸（像素）。整个 View 比身体大一圈，留出跳跃、冒爱心的空间。 */
    var bodySize: Float = dp(96f)
        set(v) {
            field = v
            requestLayout()
            invalidate()
        }

    var palette: PetPalette = PetPalette.all[0]
        set(v) {
            field = v
            invalidate()
        }

    var baseMode: Mode = Mode.IDLE
        set(v) {
            if (field != v) {
                field = v
                modeChangedAt = now()
            }
        }

    /** 1 = 朝右，-1 = 朝左（影响眼睛看的方向） */
    var facing: Int = 1

    /** 屏幕关闭时停掉动画省电 */
    var running: Boolean = true
        set(v) {
            field = v
            if (v) invalidate()
        }

    private var transientMode: Mode? = null
    private var transientUntil = 0f
    private var modeChangedAt = 0f
    private val startTime = SystemClock.uptimeMillis()
    private var lastFrame = 0f

    // 眨眼、东张西望
    private var nextBlink = 2f
    private var blinkStart = -10f
    private var lookX = 0f
    private var lookY = 0f
    private var lookTargetX = 0f
    private var lookTargetY = 0f
    private var nextLook = 1f

    // 跳一下
    private var jumpStart = -10f

    private data class Particle(
        val kind: Int, var x: Float, var y: Float, val vx: Float, val vy: Float,
        val born: Float, val life: Float, val size: Float,
    )

    private val particles = ArrayList<Particle>()
    private var nextZ = 0f
    private var nextHeart = 0f

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val path = Path()
    private val rect = RectF()

    val mode: Mode
        get() = transientMode?.takeIf { now() < transientUntil } ?: baseMode

    /** 临时切换成某个样子一会儿（比如被摸了开心 2 秒），之后回到 [baseMode]。 */
    fun flash(mode: Mode, durationMs: Long) {
        transientMode = mode
        transientUntil = now() + durationMs / 1000f
        if (mode == Mode.HAPPY) {
            jump()
            hearts(3)
        }
        invalidate()
    }

    fun jump() {
        jumpStart = now()
        invalidate()
    }

    fun hearts(n: Int) {
        val t = now()
        repeat(n) {
            particles += Particle(
                KIND_HEART, Random.nextFloat() * 0.6f - 0.3f, -0.75f, Random.nextFloat() * 0.2f - 0.1f, -0.45f,
                t + it * 0.12f, 1.3f, 0.10f + Random.nextFloat() * 0.04f,
            )
        }
        invalidate()
    }

    private fun now() = (SystemClock.uptimeMillis() - startTime) / 1000f
    private fun dp(v: Float) = v * resources.displayMetrics.density

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension((bodySize * W_RATIO).toInt(), (bodySize * H_RATIO).toInt())
    }

    override fun onDraw(canvas: Canvas) {
        val t = now()
        val dt = (t - lastFrame).coerceIn(0f, 0.1f)
        lastFrame = t
        val s = bodySize
        val mode = mode
        val pal = palette

        updateEyes(t, mode)

        val cx = width / 2f
        val groundY = height - 0.1f * s

        // ---- 身体的形变：呼吸 / 走路颠簸 / 跳跃 / 被拎起 ----
        var squash = 0f
        var bob = 0f
        var tilt = 0f
        var feetLift = 0f
        when (mode) {
            Mode.SLEEP -> squash = 0.035f * sin(2 * PI.toFloat() * t / 4f) + 0.03f
            Mode.WALK -> {
                val ph = t * 2 * PI.toFloat() * 2.2f
                bob = abs(sin(ph / 2)) * 0.05f
                tilt = 5f * sin(ph / 2)
                feetLift = sin(ph / 2)
                squash = 0.015f * sin(ph)
            }
            Mode.HAPPY -> {
                squash = 0.02f * sin(2 * PI.toFloat() * t / 2.6f)
                if (t - jumpStart > 0.7f) jump()
            }
            Mode.DRAG -> {
                squash = -0.07f
                tilt = 6f * sin(t * 5f)
            }
            Mode.TALKING -> squash = 0.025f * sin(t * 9f)
            else -> squash = 0.025f * sin(2 * PI.toFloat() * t / 2.6f)
        }
        val jp = (t - jumpStart) / 0.45f
        val jumpH = if (jp in 0f..1f) 4 * jp * (1 - jp) * 0.16f else 0f
        if (jp in 1f..1.25f) squash += 0.06f * (1 - (jp - 1) / 0.25f)

        val bottom = groundY - 0.03f * s - (jumpH + bob) * s + (if (mode == Mode.DRAG) -0.04f * s else 0f)

        // 影子
        if (mode != Mode.DRAG) {
            val k = 1f - min(1f, (jumpH + bob) * 3f)
            fill.shader = null
            fill.color = Color.argb((40 * (0.5f + 0.5f * k)).toInt(), 0, 0, 0)
            rect.set(cx - 0.33f * s * (0.6f + 0.4f * k), groundY - 0.045f * s, cx + 0.33f * s * (0.6f + 0.4f * k), groundY + 0.045f * s)
            canvas.drawOval(rect, fill)
        }

        canvas.save()
        canvas.translate(cx, bottom)
        canvas.rotate(tilt)
        canvas.scale(1f + squash, 1f - squash)

        drawFeet(canvas, s, pal, mode, feetLift, t)
        drawBody(canvas, s, pal)
        drawSprout(canvas, s, t, mode)
        drawFace(canvas, s, pal, mode, t)
        canvas.restore()

        // ---- 头顶的小特效 ----
        canvas.save()
        canvas.translate(cx, bottom)
        if (mode == Mode.THINKING) drawThinkingDots(canvas, s, t)
        updateParticles(t, dt, mode)
        drawParticles(canvas, s, t)
        canvas.restore()

        if (running && isAttachedToWindow) {
            postInvalidateDelayed(if (mode == Mode.SLEEP) 66L else 33L)
        }
    }

    private fun updateEyes(t: Float, mode: Mode) {
        if (t > nextBlink) {
            blinkStart = t
            nextBlink = t + 2.5f + Random.nextFloat() * 3f
        }
        if (t > nextLook) {
            nextLook = t + 1.5f + Random.nextFloat() * 3f
            if (Random.nextFloat() < 0.4f) {
                lookTargetX = 0f; lookTargetY = 0f
            } else {
                lookTargetX = Random.nextFloat() * 2 - 1; lookTargetY = Random.nextFloat() * 1.2f - 0.6f
            }
        }
        var tx = lookTargetX
        var ty = lookTargetY
        when (mode) {
            Mode.WALK -> { tx = facing.toFloat(); ty = 0f }
            Mode.THINKING -> { tx = 0.7f; ty = -0.9f }
            Mode.TALKING -> { tx = 0f; ty = 0f }
            else -> Unit
        }
        lookX += (tx - lookX) * 0.15f
        lookY += (ty - lookY) * 0.15f
    }

    private fun drawBody(c: Canvas, s: Float, pal: PetPalette) {
        val w = 0.95f * s
        val h = 1.0f * s
        path.reset()
        path.moveTo(-w / 2, -0.3f * h)
        path.cubicTo(-w / 2, -0.95f * h, w / 2, -0.95f * h, w / 2, -0.3f * h)
        path.cubicTo(w / 2, 0.1f * h, -w / 2, 0.1f * h, -w / 2, -0.3f * h)
        path.close()

        fill.shader = LinearGradient(0f, -0.8f * s, 0f, 0f, pal.bodyTop, pal.body, Shader.TileMode.CLAMP)
        c.drawPath(path, fill)
        fill.shader = null
        stroke.color = pal.outline
        stroke.strokeWidth = 0.03f * s
        c.drawPath(path, stroke)

        // 高光
        fill.color = Color.argb(170, 255, 255, 255)
        c.save()
        c.rotate(-28f, -0.22f * s, -0.62f * s)
        rect.set(-0.30f * s, -0.66f * s, -0.14f * s, -0.58f * s)
        c.drawOval(rect, fill)
        c.restore()
    }

    private fun drawFeet(c: Canvas, s: Float, pal: PetPalette, mode: Mode, lift: Float, t: Float) {
        fill.shader = null
        fill.color = pal.outline
        for (side in intArrayOf(-1, 1)) {
            var dy = 0f
            var dx = 0f
            when (mode) {
                Mode.WALK -> dy = -max(0f, lift * side) * 0.05f * s
                Mode.DRAG -> {
                    dy = 0.06f * s
                    dx = sin(t * 6f + side) * 0.02f * s
                }
                else -> Unit
            }
            val fx = side * 0.2f * s + dx
            rect.set(fx - 0.09f * s, -0.045f * s + dy, fx + 0.09f * s, 0.045f * s + dy)
            c.drawOval(rect, fill)
        }
    }

    private fun drawSprout(c: Canvas, s: Float, t: Float, mode: Mode) {
        val sway = when (mode) {
            Mode.WALK -> 14f * sin(t * 9f)
            Mode.HAPPY -> 12f * sin(t * 12f)
            Mode.DRAG -> 18f * sin(t * 7f)
            Mode.SLEEP -> 4f * sin(t * 1.2f)
            else -> 7f * sin(2 * PI.toFloat() * t / 3f)
        }
        c.save()
        c.translate(0f, -0.77f * s)
        c.rotate(sway)
        stroke.color = 0xFF5E9E4C.toInt()
        stroke.strokeWidth = 0.028f * s
        path.reset()
        path.moveTo(0f, 0f)
        path.quadTo(0.02f * s, -0.08f * s, 0f, -0.16f * s)
        c.drawPath(path, stroke)
        fill.shader = null
        fill.color = 0xFF86CF6E.toInt()
        for (side in intArrayOf(-1, 1)) {
            c.save()
            c.translate(0f, -0.15f * s)
            c.rotate(side * -35f)
            path.reset()
            path.moveTo(0f, 0f)
            path.quadTo(side * 0.07f * s, -0.07f * s, side * 0.15f * s, 0f)
            path.quadTo(side * 0.07f * s, 0.05f * s, 0f, 0f)
            c.drawPath(path, fill)
            c.restore()
        }
        c.restore()
    }

    private fun drawFace(c: Canvas, s: Float, pal: PetPalette, mode: Mode, t: Float) {
        val eyeY = -0.40f * s
        val eyeDX = 0.19f * s
        val ink = 0xFF3B2E2A.toInt()

        // 腮红
        fill.shader = null
        fill.color = pal.cheek
        fill.alpha = if (mode == Mode.HAPPY || mode == Mode.DRAG) 220 else 140
        for (side in intArrayOf(-1, 1)) {
            rect.set(side * 0.31f * s - 0.065f * s, -0.33f * s, side * 0.31f * s + 0.065f * s, -0.26f * s)
            c.drawOval(rect, fill)
        }
        fill.alpha = 255

        stroke.color = ink
        stroke.strokeWidth = 0.032f * s
        fill.color = ink

        val blinkP = (t - blinkStart) / 0.16f
        val openness = if (blinkP in 0f..1f) abs(1 - 2 * blinkP) else 1f

        for (side in intArrayOf(-1, 1)) {
            val ex = side * eyeDX
            when (mode) {
                Mode.HAPPY -> {
                    path.reset()
                    path.moveTo(ex - 0.05f * s, eyeY + 0.015f * s)
                    path.quadTo(ex, eyeY - 0.06f * s, ex + 0.05f * s, eyeY + 0.015f * s)
                    c.drawPath(path, stroke)
                }
                Mode.SLEEP -> {
                    path.reset()
                    path.moveTo(ex - 0.05f * s, eyeY)
                    path.quadTo(ex, eyeY + 0.045f * s, ex + 0.05f * s, eyeY)
                    c.drawPath(path, stroke)
                }
                Mode.DRAG -> {
                    path.reset()
                    val d = -side.toFloat()
                    path.moveTo(ex - d * 0.04f * s, eyeY - 0.04f * s)
                    path.lineTo(ex + d * 0.03f * s, eyeY)
                    path.lineTo(ex - d * 0.04f * s, eyeY + 0.04f * s)
                    c.drawPath(path, stroke)
                }
                else -> {
                    val px = ex + lookX * 0.03f * s
                    val py = eyeY + lookY * 0.025f * s
                    if (openness < 0.2f) {
                        c.drawLine(px - 0.045f * s, py, px + 0.045f * s, py, stroke)
                    } else {
                        rect.set(px - 0.047f * s, py - 0.062f * s * openness, px + 0.047f * s, py + 0.062f * s * openness)
                        c.drawOval(rect, fill)
                        fill.color = Color.WHITE
                        c.drawCircle(px + 0.016f * s, py - 0.024f * s * openness, 0.018f * s, fill)
                        fill.color = ink
                    }
                }
            }
        }

        // 嘴巴
        val my = -0.30f * s
        stroke.strokeWidth = 0.026f * s
        when (mode) {
            Mode.TALKING -> {
                val open = 0.012f * s + 0.03f * s * abs(sin(t * 11f))
                fill.color = 0xFF9A3F48.toInt()
                rect.set(-0.04f * s, my - open / 2, 0.04f * s, my + open / 2)
                c.drawOval(rect, fill)
            }
            Mode.HAPPY -> {
                fill.color = 0xFF9A3F48.toInt()
                path.reset()
                path.moveTo(-0.055f * s, my - 0.01f * s)
                path.quadTo(0f, my + 0.08f * s, 0.055f * s, my - 0.01f * s)
                path.close()
                c.drawPath(path, fill)
            }
            Mode.SLEEP -> {
                c.drawCircle(0f, my + 0.005f * s, 0.016f * s + 0.004f * s * sin(t * 1.5f), stroke)
            }
            Mode.DRAG -> {
                fill.color = 0xFF9A3F48.toInt()
                rect.set(-0.025f * s, my - 0.03f * s, 0.025f * s, my + 0.03f * s)
                c.drawOval(rect, fill)
            }
            Mode.THINKING -> {
                path.reset()
                path.moveTo(-0.035f * s, my)
                path.quadTo(-0.012f * s, my - 0.015f * s, 0f, my)
                path.quadTo(0.012f * s, my + 0.015f * s, 0.035f * s, my)
                c.drawPath(path, stroke)
            }
            else -> {
                // 小小的 ω 嘴
                path.reset()
                path.moveTo(-0.05f * s, my - 0.012f * s)
                path.quadTo(-0.025f * s, my + 0.03f * s, 0f, my - 0.005f * s)
                path.quadTo(0.025f * s, my + 0.03f * s, 0.05f * s, my - 0.012f * s)
                c.drawPath(path, stroke)
            }
        }
    }

    private fun drawThinkingDots(c: Canvas, s: Float, t: Float) {
        fill.shader = null
        for (i in 0..2) {
            val ph = t * 5f - i * 0.6f
            val up = max(0f, sin(ph)) * 0.04f * s
            fill.color = palette.outline
            c.drawCircle((0.26f + i * 0.1f) * s, -0.95f * s - up, 0.028f * s, fill)
        }
    }

    private fun updateParticles(t: Float, dt: Float, mode: Mode) {
        if (mode == Mode.SLEEP && t > nextZ) {
            nextZ = t + 1.1f
            particles += Particle(KIND_Z, 0.2f, -0.8f, 0.12f, -0.22f, t, 2.6f, 0.11f + Random.nextFloat() * 0.06f)
        }
        if (mode == Mode.HAPPY && t > nextHeart) {
            nextHeart = t + 0.5f
            hearts(1)
        }
        val it = particles.iterator()
        while (it.hasNext()) {
            val p = it.next()
            if (t < p.born) continue
            if (t - p.born > p.life) {
                it.remove(); continue
            }
            p.x += p.vx * dt
            p.y += p.vy * dt
        }
    }

    private fun drawParticles(c: Canvas, s: Float, t: Float) {
        for (p in particles) {
            if (t < p.born) continue
            val age = (t - p.born) / p.life
            val alpha = (255 * (1 - age) * min(1f, age * 6f)).toInt().coerceIn(0, 255)
            val x = p.x * s
            val y = p.y * s
            when (p.kind) {
                KIND_HEART -> {
                    fill.shader = null
                    fill.color = 0xFFFF6B8E.toInt()
                    fill.alpha = alpha
                    val r = p.size * s
                    path.reset()
                    path.moveTo(x, y + r * 0.35f)
                    path.cubicTo(x - r * 0.9f, y - r * 0.25f, x - r * 0.35f, y - r * 0.85f, x, y - r * 0.35f)
                    path.cubicTo(x + r * 0.35f, y - r * 0.85f, x + r * 0.9f, y - r * 0.25f, x, y + r * 0.35f)
                    c.drawPath(path, fill)
                    fill.alpha = 255
                }
                KIND_Z -> {
                    text.color = palette.outline
                    text.alpha = alpha
                    text.textSize = p.size * s * 1.6f
                    c.drawText("z", x, y, text)
                }
            }
        }
    }

    companion object {
        const val W_RATIO = 1.45f
        const val H_RATIO = 1.6f
        private const val KIND_HEART = 0
        private const val KIND_Z = 1
    }
}
