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
import kotlin.math.cos
import kotlin.math.hypot
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
 * 用代码画出来的桌宠“团子”：圆滚滚的果冻身体、头顶一棵小嫩芽。
 * 负责所有表情、姿势、特效和果冻一样的弹性；在屏幕上怎么动由 [PetController] 决定。
 */
class PetView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    var bodySize: Float = 96f * resources.displayMetrics.density
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

    /** 平时的表情 */
    var face: Face = Face.NORMAL
        set(v) {
            if (field != v) {
                field = v
                faceSince = now()
                if (v == Face.SURPRISED) impulse(-2f, 0f)
            }
        }
    private var flashFace: Face? = null
    private var flashUntil = 0f
    private var faceSince = 0f

    var pose: Pose = Pose.STAND
        set(v) {
            if (field != v) {
                if (v == Pose.SIT || v == Pose.LIE) impulse(2f, 0f)
                field = v
            }
        }

    /** 在墙上爬动 / 在地上走（让脚动起来） */
    var moving = false
    var facing = 1
    var talking = false

    /** 飞行速度（像素/秒），用于拉伸身体 */
    var velX = 0f
    var velY = 0f

    /** 被扔出去时的旋转速度（度/秒） */
    var spinSpeed = 0f
    private var spin = 0f

    var running: Boolean = true
        set(v) {
            field = v
            if (v) invalidate()
        }

    private val startTime = SystemClock.uptimeMillis()
    private var lastFrame = 0f

    // 果冻弹簧：压扁 / 左右晃
    private var squash = 0f
    private var squashV = 0f
    private var lean = 0f
    private var leanV = 0f

    // 眼睛
    private var nextBlink = 2f
    private var blinkStart = -10f
    private var lookX = 0f
    private var lookY = 0f
    private var lookTX = 0f
    private var lookTY = 0f
    private var lookHoldUntil = 0f
    private var nextLook = 1f

    private class Particle(
        val kind: Int, var x: Float, var y: Float, val vx: Float, val vy: Float,
        val born: Float, val life: Float, val size: Float, val rot: Float = 0f,
    )

    private val particles = ArrayList<Particle>()
    private var nextAuto = 0f
    private var exclaimUntil = 0f
    private var exclaimText = "!"

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
    private val bodyPath = Path()
    private val rect = RectF()

    /** 现在实际显示的表情 */
    val shownFace: Face get() = flashFace?.takeIf { now() < flashUntil } ?: face

    /** 身体底部中点在 View 里的位置（站着时） */
    val footX get() = width.coerceAtLeast(measuredWidth) / 2f
    val footY get() = height.coerceAtLeast(measuredHeight) - 0.13f * bodySize

    fun flash(f: Face, ms: Long) {
        flashFace = f
        flashUntil = now() + ms / 1000f
        if (f == Face.HAPPY || f == Face.LOVE) impulse(-2.5f, 0f)
        invalidate()
    }

    fun lookAt(x: Float, y: Float, holdMs: Long = 2500) {
        lookTX = x.coerceIn(-1f, 1f)
        lookTY = y.coerceIn(-1f, 1f)
        lookHoldUntil = now() + holdMs / 1000f
    }

    /** 给果冻身体一个冲击：squash 正数压扁、负数拉长；lean 左右晃 */
    fun impulse(squashVel: Float, leanVel: Float) {
        squashV += squashVel
        leanV += leanVel
        invalidate()
    }

    /** 戳到某个位置：那里凹一下 */
    fun pokeAt(localX: Float, localY: Float) {
        val dx = (localX - footX) / bodySize
        impulse(3f, dx * 160f)
        lookAt(dx.coerceIn(-1f, 1f), -0.3f, 900)
    }

    fun effect(e: Effect) {
        val t = now()
        when (e) {
            Effect.HEARTS -> repeat(3 + Random.nextInt(2)) {
                particles += Particle(K_HEART, rf(-0.32f, 0.32f), -0.78f, rf(-0.1f, 0.1f), -0.45f, t + it * 0.12f, 1.3f, rf(0.1f, 0.14f))
            }
            Effect.NOTES -> repeat(2) {
                particles += Particle(K_NOTE, rf(0.15f, 0.4f) * if (it == 0) 1 else -1, -0.75f, rf(-0.08f, 0.08f), -0.35f, t + it * 0.35f, 1.6f, rf(0.16f, 0.2f))
            }
            Effect.EXCLAIM -> { exclaimText = "!"; exclaimUntil = t + 0.9f }
            Effect.QUESTION -> { exclaimText = "?"; exclaimUntil = t + 1.2f }
            Effect.SPARKLES -> repeat(4) {
                val a = rf(0f, 6.28f)
                particles += Particle(K_SPARK, cos(a) * 0.55f, -0.4f + sin(a) * 0.45f, 0f, -0.05f, t + it * 0.1f, 0.9f, rf(0.06f, 0.1f))
            }
            Effect.BOLTS -> repeat(2) {
                val side = if (it == 0) -1 else 1
                particles += Particle(K_BOLT, side * 0.6f, -0.05f, -side * 0.3f, -0.3f, t + it * 0.2f, 1.0f, 0.16f, side * 15f)
            }
            Effect.CRUMBS -> repeat(4) {
                particles += Particle(K_CRUMB, rf(-0.08f, 0.08f), -0.27f, rf(-0.25f, 0.25f), rf(0.05f, 0.25f), t, 0.7f, rf(0.015f, 0.025f))
            }
            Effect.STEAM -> repeat(4) {
                val side = if (it % 2 == 0) -1 else 1
                particles += Particle(K_STEAM, side * 0.32f, -0.72f, side * 0.25f, -0.4f, t + (it / 2) * 0.35f, 0.9f, rf(0.05f, 0.08f))
            }
            Effect.SWEAT -> particles += Particle(K_SWEAT, 0.4f, -0.68f, 0.02f, 0.18f, t, 1.2f, 0.06f)
        }
        invalidate()
    }

    private fun rf(a: Float, b: Float) = a + Random.nextFloat() * (b - a)
    private fun now() = (SystemClock.uptimeMillis() - startTime) / 1000f

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension((bodySize * W_RATIO).toInt(), (bodySize * H_RATIO).toInt())
    }

    // =====================================================================

    override fun onDraw(canvas: Canvas) {
        val t = now()
        val dt = (t - lastFrame).coerceIn(0f, 0.05f)
        lastFrame = t
        val s = bodySize
        val f = shownFace
        val pal = palette

        stepSprings(dt)
        updateEyes(t, f)

        val cx = width / 2f
        val groundY = height - 0.1f * s
        var bottom = groundY - 0.03f * s

        // ---- 姿势带来的形变 ----
        var sx = 1f
        var sy = 1f
        var tilt = lean
        var feetMode = FEET_STAND
        var bob = 0f
        val breath = sin(2 * PI.toFloat() * t / (if (f == Face.SLEEP) 4f else 2.6f)) * (if (f == Face.SLEEP) 0.035f else 0.022f)
        var squashTotal = squash + breath
        var showShadow = true
        var clingRot = 0f

        when (pose) {
            Pose.STAND -> if (moving) {
                val ph = t * 2 * PI.toFloat() * 2.2f
                bob = abs(sin(ph / 2)) * 0.05f
                tilt += 5f * sin(ph / 2)
                feetMode = FEET_WALK
            }
            Pose.WALK -> {
                val ph = t * 2 * PI.toFloat() * 2.2f
                bob = abs(sin(ph / 2)) * 0.05f
                tilt += 5f * sin(ph / 2)
                feetMode = FEET_WALK
            }
            Pose.SIT -> { sx *= 1.07f; sy *= 0.9f; feetMode = FEET_SIT }
            Pose.LIE -> { sx *= 1.16f; sy *= 0.8f; feetMode = FEET_HIDE; squashTotal = squash + breath * 0.6f }
            Pose.DANCE -> {
                val ph = t * 2 * PI.toFloat() * 2f
                bob = abs(sin(ph)) * 0.08f
                tilt += 9f * sin(ph / 2)
                squashTotal += 0.04f * cos(ph * 2)
                feetMode = FEET_WALK
            }
            Pose.HELD -> {
                sx *= 0.93f; sy *= 1.08f
                tilt += (-velX / s * 4f).coerceIn(-25f, 25f) + 4f * sin(t * 4f)
                feetMode = FEET_DANGLE
                showShadow = false
                bottom -= 0.05f * s
            }
            Pose.AIR -> {
                val sp = hypot(velX, velY)
                if (sp > 1f) {
                    val k = min(0.22f, sp / (s * 40f))
                    val ax = abs(velX) / sp
                    val ay = abs(velY) / sp
                    sx *= 1f + k * (ax - 0.5f * ay)
                    sy *= 1f + k * (ay - 0.5f * ax)
                }
                feetMode = FEET_KICK
                showShadow = false
                bottom -= 0.08f * s
            }
            Pose.CLING_LEFT, Pose.CLING_RIGHT -> {
                clingRot = if (pose == Pose.CLING_LEFT) 90f else -90f
                feetMode = if (moving) FEET_WALK else FEET_STAND
                if (moving) bob = abs(sin(t * 2 * PI.toFloat() * 2f)) * 0.03f
                showShadow = false
            }
        }

        // 被扔出去时转圈，落地后转回正
        if (pose == Pose.AIR) spin += spinSpeed * dt
        else if (spin != 0f) {
            var r = spin % 360f
            if (r > 180f) r -= 360f
            if (r < -180f) r += 360f
            spin = if (abs(r) < 2f) 0f else r * (1f - min(1f, dt * 10f))
        }

        bottom -= bob * s

        // 影子
        if (showShadow) {
            val k = 1f - min(1f, bob * 4f)
            fill.shader = null
            fill.color = Color.argb((38 * (0.5f + 0.5f * k)).toInt(), 0, 0, 0)
            val w = 0.34f * s * (0.65f + 0.35f * k) * (if (pose == Pose.LIE) 1.15f else 1f)
            rect.set(cx - w, groundY - 0.04f * s, cx + w, groundY + 0.045f * s)
            canvas.drawOval(rect, fill)
        }

        canvas.save()
        canvas.translate(cx, bottom)
        val center = -0.4f * s
        if (clingRot != 0f || spin != 0f) {
            canvas.translate(0f, center)
            canvas.rotate(clingRot + spin)
            canvas.translate(0f, -center)
        }
        canvas.rotate(tilt)
        canvas.scale(sx * (1f + squashTotal), sy * (1f - squashTotal))

        drawFeet(canvas, s, pal, feetMode, t)
        drawBody(canvas, s, pal, f)
        drawSprout(canvas, s, t)
        drawFace(canvas, s, pal, f, t)
        canvas.restore()

        // ---- 头顶的特效（不跟着身体旋转）----
        canvas.save()
        val effY = if (clingRot != 0f) bottom - 0.15f * s else bottom
        canvas.translate(cx, effY)
        drawFaceEffects(canvas, s, f, t)
        updateParticles(t, dt, f)
        drawParticles(canvas, s, t)
        canvas.restore()

        if (running && isAttachedToWindow) {
            postInvalidateDelayed(if (f == Face.SLEEP && pose == Pose.LIE) 66L else 33L)
        }
    }

    private fun stepSprings(dt: Float) {
        val k = 220f
        val c = 11f
        squashV += (-k * squash - c * squashV) * dt
        squash += squashV * dt
        leanV += (-k * lean - c * leanV) * dt
        lean += leanV * dt
        squash = squash.coerceIn(-0.3f, 0.35f)
        lean = lean.coerceIn(-30f, 30f)
    }

    private fun updateEyes(t: Float, f: Face) {
        if (t > nextBlink) {
            blinkStart = t
            nextBlink = t + 2.2f + Random.nextFloat() * 3.5f
        }
        if (t > nextLook && t > lookHoldUntil) {
            nextLook = t + 1.5f + Random.nextFloat() * 3f
            if (Random.nextFloat() < 0.45f) { lookTX = 0f; lookTY = 0f }
            else { lookTX = Random.nextFloat() * 2 - 1; lookTY = Random.nextFloat() * 1.2f - 0.6f }
        }
        var tx = lookTX
        var ty = lookTY
        when {
            pose == Pose.WALK || (moving && pose == Pose.STAND) -> { tx = facing.toFloat(); ty = 0f }
            f == Face.THINK -> { tx = 0.7f; ty = -0.9f }
            f == Face.SHY -> { tx = -1f; ty = 1f }
            f == Face.ANNOYED -> { tx = 1f; ty = 0.15f }
            talking -> { tx = 0f; ty = 0f }
        }
        lookX += (tx - lookX) * 0.15f
        lookY += (ty - lookY) * 0.15f
    }

    // ---------------- 身体 ----------------

    private fun drawBody(c: Canvas, s: Float, pal: PetPalette, f: Face) {
        val w = 0.95f * s
        val h = 1.0f * s
        bodyPath.reset()
        bodyPath.moveTo(-w / 2, -0.3f * h)
        bodyPath.cubicTo(-w / 2, -0.95f * h, w / 2, -0.95f * h, w / 2, -0.3f * h)
        bodyPath.cubicTo(w / 2, 0.1f * h, -w / 2, 0.1f * h, -w / 2, -0.3f * h)
        bodyPath.close()

        fill.color = Color.WHITE // 重置透明度（画影子时改过）
        fill.shader = LinearGradient(0f, -0.8f * s, 0f, 0f, pal.bodyTop, pal.body, Shader.TileMode.CLAMP)
        c.drawPath(bodyPath, fill)
        fill.shader = null
        if (f == Face.ANGRY) {
            fill.color = Color.argb(70, 255, 60, 60)
            c.drawPath(bodyPath, fill)
        }
        stroke.color = pal.outline
        stroke.strokeWidth = 0.03f * s
        c.drawPath(bodyPath, stroke)

        fill.color = Color.argb(170, 255, 255, 255)
        c.save()
        c.rotate(-28f, -0.22f * s, -0.62f * s)
        rect.set(-0.30f * s, -0.66f * s, -0.14f * s, -0.58f * s)
        c.drawOval(rect, fill)
        c.restore()
    }

    private fun drawFeet(c: Canvas, s: Float, pal: PetPalette, mode: Int, t: Float) {
        if (mode == FEET_HIDE) return
        fill.shader = null
        fill.color = pal.outline
        for (side in intArrayOf(-1, 1)) {
            var dy = 0f
            var dx = 0f
            var fw = 0.09f
            when (mode) {
                FEET_WALK -> dy = -max(0f, sin(t * 2 * PI.toFloat() * 1.1f) * side) * 0.05f * s
                FEET_SIT -> { dx = side * 0.05f * s; dy = 0.01f * s; fw = 0.085f }
                FEET_DANGLE -> { dy = 0.07f * s; dx = sin(t * 6f + side) * 0.02f * s }
                FEET_KICK -> { dy = 0.04f * s + sin(t * 22f + side * 1.6f) * 0.035f * s; dx = side * 0.02f * s }
            }
            val fx = side * 0.2f * s + dx
            rect.set(fx - fw * s, -0.045f * s + dy, fx + fw * s, 0.045f * s + dy)
            c.drawOval(rect, fill)
        }
    }

    private fun drawSprout(c: Canvas, s: Float, t: Float) {
        val sway = when (pose) {
            Pose.WALK, Pose.DANCE -> 14f * sin(t * 9f)
            Pose.AIR, Pose.HELD -> 20f * sin(t * 8f)
            Pose.LIE -> 4f * sin(t * 1.2f)
            else -> 7f * sin(2 * PI.toFloat() * t / 3f)
        } - lean * 1.5f
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

    // ---------------- 脸 ----------------

    private val ink = 0xFF3B2E2A.toInt()
    private val mouthRed = 0xFF9A3F48.toInt()

    private fun drawFace(c: Canvas, s: Float, pal: PetPalette, f: Face, t: Float) {
        val eyeY = -0.40f * s
        val eyeDX = 0.19f * s

        // 腮红
        fill.shader = null
        fill.color = pal.cheek
        val strongBlush = f == Face.HAPPY || f == Face.LOVE || f == Face.BLISS || f == Face.SHY || f == Face.EAT
        fill.alpha = if (strongBlush) 225 else 140
        val cheekR = if (f == Face.EAT) 0.085f else 0.065f
        for (side in intArrayOf(-1, 1)) {
            rect.set(side * 0.31f * s - cheekR * s, -0.335f * s, side * 0.31f * s + cheekR * s, -0.255f * s)
            c.drawOval(rect, fill)
        }
        fill.alpha = 255
        if (f == Face.SHY) {
            stroke.color = 0xFFE5577E.toInt()
            stroke.strokeWidth = 0.014f * s
            for (side in intArrayOf(-1, 1)) for (i in 0..2) {
                val x0 = side * 0.31f * s + (i - 1) * 0.03f * s
                c.drawLine(x0 + 0.012f * s, -0.32f * s, x0 - 0.012f * s, -0.27f * s, stroke)
            }
        }

        stroke.color = ink
        stroke.strokeWidth = 0.032f * s
        fill.color = ink

        val blinkP = (t - blinkStart) / 0.16f
        var open = if (blinkP in 0f..1f) abs(1 - 2 * blinkP) else 1f

        for (side in intArrayOf(-1, 1)) {
            val ex = side * eyeDX
            val reach = if (f == Face.SHY || f == Face.ANNOYED) 0.05f else 0.03f
            val px = ex + lookX * reach * s
            val py = eyeY + lookY * 0.025f * s
            when (f) {
                Face.HAPPY, Face.EAT -> arch(c, ex, eyeY, s, up = true)
                Face.BLISS -> arch(c, ex, eyeY + 0.01f * s, s, up = false)
                Face.SLEEP -> {
                    path.reset()
                    path.moveTo(ex - 0.05f * s, eyeY + 0.005f * s)
                    path.quadTo(ex, eyeY + 0.03f * s, ex + 0.05f * s, eyeY + 0.005f * s)
                    c.drawPath(path, stroke)
                }
                Face.PAIN -> {
                    val d = -side.toFloat()
                    path.reset()
                    path.moveTo(ex - d * 0.04f * s, eyeY - 0.04f * s)
                    path.lineTo(ex + d * 0.03f * s, eyeY)
                    path.lineTo(ex - d * 0.04f * s, eyeY + 0.04f * s)
                    c.drawPath(path, stroke)
                }
                Face.LOVE -> {
                    fill.color = 0xFFFF4F7B.toInt()
                    heart(c, ex, eyeY + 0.01f * s, 0.085f * s * (1f + 0.08f * sin(t * 8f)))
                    fill.color = ink
                }
                Face.DIZZY -> spiral(c, ex, eyeY, 0.055f * s, t * 6f * side)
                Face.SURPRISED -> {
                    fill.color = ink
                    c.drawCircle(ex, eyeY, 0.065f * s, fill)
                    fill.color = Color.WHITE
                    c.drawCircle(ex + 0.02f * s, eyeY - 0.024f * s, 0.024f * s, fill)
                    c.drawCircle(ex - 0.02f * s, eyeY + 0.02f * s, 0.01f * s, fill)
                    fill.color = ink
                }
                Face.SLEEPY, Face.ANNOYED -> {
                    // 半闭的眼睛：上面一条平的眼皮
                    // 困：眼皮耷拉得很低、一点点往下沉；不耐烦：眼皮平平地压一半，斜眼看
                    val lid = if (f == Face.SLEEPY) 0.022f * s + 0.01f * s * sin(t * 1.5f) else -0.008f * s
                    val ry = if (f == Face.SLEEPY) 0.05f else 0.055f
                    rect.set(px - 0.047f * s, py - ry * s, px + 0.047f * s, py + ry * s)
                    c.save()
                    c.clipRect(px - 0.06f * s, py + lid, px + 0.06f * s, py + 0.07f * s)
                    c.drawOval(rect, fill)
                    c.restore()
                    c.drawLine(px - 0.055f * s, py + lid, px + 0.055f * s, py + lid, stroke)
                }
                else -> {
                    var sz = 1f
                    if (f == Face.WORRIED || f == Face.SAD) sz = 0.88f
                    if (f == Face.SHY) { sz = 0.85f; open = min(open, 0.7f) }
                    if (open < 0.2f) {
                        c.drawLine(px - 0.045f * s, py, px + 0.045f * s, py, stroke)
                    } else {
                        rect.set(px - 0.047f * s * sz, py - 0.062f * s * open * sz, px + 0.047f * s * sz, py + 0.062f * s * open * sz)
                        c.drawOval(rect, fill)
                        fill.color = Color.WHITE
                        c.drawCircle(px + 0.016f * s, py - 0.024f * s * open, 0.018f * s, fill)
                        if (f == Face.SAD) c.drawCircle(px - 0.015f * s, py + 0.02f * s, 0.01f * s, fill)
                        fill.color = ink
                    }
                }
            }
        }

        // 眉毛
        val browY = eyeY - 0.1f * s
        stroke.strokeWidth = 0.022f * s
        when (f) {
            Face.ANGRY -> for (side in intArrayOf(-1, 1)) {
                c.drawLine(side * 0.26f * s, browY - 0.03f * s, side * 0.11f * s, browY + 0.03f * s, stroke)
            }
            Face.SAD, Face.WORRIED -> for (side in intArrayOf(-1, 1)) {
                c.drawLine(side * 0.26f * s, browY + 0.025f * s, side * 0.11f * s, browY - 0.035f * s, stroke)
            }
            else -> Unit
        }

        // 嘴巴
        val my = -0.30f * s
        stroke.strokeWidth = 0.026f * s
        if (talking && f != Face.EAT && f != Face.SLEEP) {
            val o = 0.012f * s + 0.03f * s * abs(sin(t * 11f))
            fill.color = mouthRed
            rect.set(-0.04f * s, my - o / 2, 0.04f * s, my + o / 2)
            c.drawOval(rect, fill)
            return
        }
        when (f) {
            Face.HAPPY, Face.LOVE -> {
                fill.color = mouthRed
                path.reset()
                path.moveTo(-0.055f * s, my - 0.01f * s)
                path.quadTo(0f, my + 0.08f * s, 0.055f * s, my - 0.01f * s)
                path.close()
                c.drawPath(path, fill)
            }
            Face.BLISS -> {
                path.reset()
                path.moveTo(-0.05f * s, my - 0.01f * s)
                path.quadTo(0f, my + 0.045f * s, 0.05f * s, my - 0.01f * s)
                c.drawPath(path, stroke)
            }
            Face.SURPRISED -> {
                fill.color = mouthRed
                rect.set(-0.03f * s, my - 0.035f * s, 0.03f * s, my + 0.035f * s)
                c.drawOval(rect, fill)
            }
            Face.SLEEP -> c.drawCircle(0f, my + 0.005f * s, 0.016f * s + 0.004f * s * sin(t * 1.5f), stroke)
            Face.ANGRY, Face.SAD -> {
                path.reset()
                path.moveTo(-0.045f * s, my + 0.02f * s)
                path.quadTo(0f, my - 0.03f * s, 0.045f * s, my + 0.02f * s)
                c.drawPath(path, stroke)
            }
            Face.ANNOYED -> c.drawLine(-0.04f * s, my + 0.008f * s, 0.04f * s, my - 0.004f * s, stroke)
            Face.EAT -> {
                val chew = abs(sin(t * 9f))
                fill.color = mouthRed
                rect.set(-0.035f * s, my - 0.008f * s - chew * 0.018f * s, 0.035f * s, my + 0.008f * s + chew * 0.018f * s)
                c.drawOval(rect, fill)
            }
            Face.PAIN, Face.WORRIED, Face.DIZZY, Face.SHY, Face.THINK -> {
                val w = if (f == Face.SHY || f == Face.THINK) 0.035f else 0.05f
                path.reset()
                path.moveTo(-w * s, my)
                path.quadTo(-w / 2 * s, my - 0.018f * s, 0f, my)
                path.quadTo(w / 2 * s, my + 0.018f * s, w * s, my)
                c.drawPath(path, stroke)
            }
            Face.SLEEPY -> c.drawCircle(0f, my, 0.013f * s, stroke)
            else -> {
                path.reset()
                path.moveTo(-0.05f * s, my - 0.012f * s)
                path.quadTo(-0.025f * s, my + 0.03f * s, 0f, my - 0.005f * s)
                path.quadTo(0.025f * s, my + 0.03f * s, 0.05f * s, my - 0.012f * s)
                c.drawPath(path, stroke)
            }
        }
    }

    private fun arch(c: Canvas, ex: Float, ey: Float, s: Float, up: Boolean) {
        path.reset()
        if (up) {
            path.moveTo(ex - 0.05f * s, ey + 0.015f * s)
            path.quadTo(ex, ey - 0.06f * s, ex + 0.05f * s, ey + 0.015f * s)
        } else {
            path.moveTo(ex - 0.05f * s, ey - 0.012f * s)
            path.quadTo(ex, ey + 0.05f * s, ex + 0.05f * s, ey - 0.012f * s)
        }
        c.drawPath(path, stroke)
    }

    private fun spiral(c: Canvas, x: Float, y: Float, r: Float, rot: Float) {
        path.reset()
        val turns = 2.2f
        val n = 28
        for (i in 0..n) {
            val k = i / n.toFloat()
            val a = rot + k * turns * 2 * PI.toFloat()
            val rr = r * k
            val px = x + cos(a) * rr
            val py = y + sin(a) * rr
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        val w = stroke.strokeWidth
        stroke.strokeWidth = w * 0.6f
        c.drawPath(path, stroke)
        stroke.strokeWidth = w
    }

    private fun heart(c: Canvas, x: Float, y: Float, r: Float) {
        path.reset()
        path.moveTo(x, y + r * 0.45f)
        path.cubicTo(x - r * 1.0f, y - r * 0.2f, x - r * 0.4f, y - r * 0.9f, x, y - r * 0.35f)
        path.cubicTo(x + r * 0.4f, y - r * 0.9f, x + r * 1.0f, y - r * 0.2f, x, y + r * 0.45f)
        c.drawPath(path, fill)
    }

    // ---------------- 跟着表情的持续特效 ----------------

    private fun drawFaceEffects(c: Canvas, s: Float, f: Face, t: Float) {
        fill.shader = null
        when (f) {
            Face.THINK -> for (i in 0..2) {
                val up = max(0f, sin(t * 5f - i * 0.6f)) * 0.04f * s
                fill.color = palette.outline
                c.drawCircle((0.26f + i * 0.1f) * s, -0.95f * s - up, 0.028f * s, fill)
            }
            Face.DIZZY -> for (i in 0..2) {
                val a = t * 4f + i * 2.09f
                val x = cos(a) * 0.36f * s
                val y = -0.86f * s + sin(a) * 0.08f * s
                fill.color = 0xFFFFC94A.toInt()
                star4(c, x, y, 0.05f * s * (0.8f + 0.2f * sin(a)))
            }
            Face.ANGRY -> {
                // 生气的“井”字青筋
                val pulse = 1f + 0.12f * sin(t * 10f)
                stroke.color = 0xFFE5484D.toInt()
                stroke.strokeWidth = 0.022f * s
                c.save()
                c.translate(0.3f * s, -0.72f * s)
                c.scale(pulse, pulse)
                val a = 0.025f * s
                val b = 0.07f * s
                c.drawLine(-b, -a, -a, -a, stroke); c.drawLine(-a, -a, -a, -b, stroke)
                c.drawLine(a, -b, a, -a, stroke); c.drawLine(a, -a, b, -a, stroke)
                c.drawLine(b, a, a, a, stroke); c.drawLine(a, a, a, b, stroke)
                c.drawLine(-a, b, -a, a, stroke); c.drawLine(-a, a, -b, a, stroke)
                c.restore()
            }
            Face.SAD -> {
                // 一滴眼泪慢慢流下来
                val k = (t - faceSince) % 1.8f / 1.8f
                fill.color = 0xFF7EC8F2.toInt()
                fill.alpha = (255 * (1 - k)).toInt()
                drop(c, -0.2f * s, -0.33f * s + k * 0.12f * s, 0.035f * s)
                fill.alpha = 255
            }
            else -> Unit
        }
        if (t < exclaimUntil) {
            val p = 1f - (exclaimUntil - t)
            val scale = if (p < 0.15f) p / 0.15f * 1.2f else 1f
            text.color = 0xFFFF6B3D.toInt()
            text.textSize = 0.32f * s * scale
            c.drawText(exclaimText, 0.38f * s, -0.82f * s, text)
        }
    }

    private fun star4(c: Canvas, x: Float, y: Float, r: Float) {
        path.reset()
        path.moveTo(x, y - r)
        path.quadTo(x, y, x + r, y)
        path.quadTo(x, y, x, y + r)
        path.quadTo(x, y, x - r, y)
        path.quadTo(x, y, x, y - r)
        c.drawPath(path, fill)
    }

    private fun drop(c: Canvas, x: Float, y: Float, r: Float) {
        path.reset()
        path.moveTo(x, y - r * 1.4f)
        path.quadTo(x + r, y, x, y + r)
        path.quadTo(x - r, y, x, y - r * 1.4f)
        c.drawPath(path, fill)
    }

    private fun bolt(c: Canvas, x: Float, y: Float, r: Float) {
        path.reset()
        path.moveTo(x + 0.2f * r, y - r)
        path.lineTo(x - 0.45f * r, y + 0.1f * r)
        path.lineTo(x - 0.02f * r, y + 0.1f * r)
        path.lineTo(x - 0.25f * r, y + r)
        path.lineTo(x + 0.45f * r, y - 0.15f * r)
        path.lineTo(x + 0.02f * r, y - 0.15f * r)
        path.close()
        c.drawPath(path, fill)
    }

    // ---------------- 粒子 ----------------

    private fun updateParticles(t: Float, dt: Float, f: Face) {
        if (t > nextAuto) {
            when (f) {
                Face.SLEEP -> {
                    nextAuto = t + 1.1f
                    particles += Particle(K_Z, 0.2f, -0.8f, 0.12f, -0.22f, t, 2.6f, rf(0.11f, 0.17f))
                }
                Face.LOVE -> {
                    nextAuto = t + 0.6f
                    particles += Particle(K_HEART, rf(-0.3f, 0.3f), -0.78f, rf(-0.1f, 0.1f), -0.45f, t, 1.2f, rf(0.08f, 0.12f))
                }
                Face.BLISS -> {
                    nextAuto = t + 0.9f
                    particles += Particle(K_HEART, rf(-0.3f, 0.3f), -0.78f, rf(-0.1f, 0.1f), -0.4f, t, 1.2f, rf(0.07f, 0.1f))
                }
                else -> nextAuto = t + 0.3f
            }
        }
        val it = particles.iterator()
        while (it.hasNext()) {
            val p = it.next()
            if (t < p.born) continue
            if (t - p.born > p.life) { it.remove(); continue }
            p.x += p.vx * dt
            p.y += p.vy * dt
        }
        if (particles.size > 60) particles.subList(0, particles.size - 60).clear()
    }

    private fun drawParticles(c: Canvas, s: Float, t: Float) {
        fill.shader = null
        for (p in particles) {
            if (t < p.born) continue
            val age = (t - p.born) / p.life
            val alpha = (255 * (1 - age) * min(1f, age * 6f)).toInt().coerceIn(0, 255)
            val x = p.x * s
            val y = p.y * s
            val r = p.size * s
            when (p.kind) {
                K_HEART -> { fill.color = 0xFFFF6B8E.toInt(); fill.alpha = alpha; heart(c, x, y, r) }
                K_Z -> {
                    text.color = palette.outline; text.alpha = alpha; text.textSize = r * 1.6f
                    c.drawText("z", x, y, text)
                }
                K_NOTE -> {
                    text.color = palette.outline; text.alpha = alpha; text.textSize = r * 1.4f
                    c.drawText("♪", x + sin((t - p.born) * 6f) * 0.03f * s, y, text)
                }
                K_SPARK -> { fill.color = 0xFFFFD25E.toInt(); fill.alpha = alpha; star4(c, x, y, r * (0.6f + 0.4f * sin(age * 9f))) }
                K_BOLT -> {
                    fill.color = 0xFFFFB300.toInt(); fill.alpha = alpha; bolt(c, x, y, r)
                    stroke.color = 0xFFFFFFFF.toInt(); stroke.alpha = alpha; stroke.strokeWidth = 0.012f * s
                    c.drawPath(path, stroke); stroke.alpha = 255
                }
                K_CRUMB -> {
                    fill.color = 0xFFB07A44.toInt(); fill.alpha = alpha
                    c.drawCircle(x, y + age * age * 0.25f * s, r, fill)
                }
                K_STEAM -> { fill.color = 0xFFDDDDDD.toInt(); fill.alpha = (alpha * 0.8f).toInt(); c.drawCircle(x, y, r * (1f + age), fill) }
                K_SWEAT -> { fill.color = 0xFF7EC8F2.toInt(); fill.alpha = alpha; drop(c, x, y, r) }
            }
        }
        fill.alpha = 255
        text.alpha = 255
    }

    companion object {
        const val W_RATIO = 1.45f
        const val H_RATIO = 1.6f
        private const val K_HEART = 0
        private const val K_Z = 1
        private const val K_NOTE = 2
        private const val K_SPARK = 3
        private const val K_BOLT = 4
        private const val K_CRUMB = 5
        private const val K_STEAM = 6
        private const val K_SWEAT = 7
        private const val FEET_STAND = 0
        private const val FEET_WALK = 1
        private const val FEET_SIT = 2
        private const val FEET_HIDE = 3
        private const val FEET_DANGLE = 4
        private const val FEET_KICK = 5
    }
}
