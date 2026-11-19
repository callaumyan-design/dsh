package io.github.callaumyan.aipet.pet

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.Choreographer
import android.view.View
import android.view.WindowManager
import kotlin.random.Random

/** 喂食：一个小零食从屏幕上方掉下来，落到桌宠嘴边。 */
class FoodWindow(private val ctx: Context, private val wm: WindowManager) {
    private val density = ctx.resources.displayMetrics.density
    private val sizePx = (34 * density).toInt()
    private var view: SnackView? = null
    private val params = Overlay.baseParams(sizePx, sizePx, focusable = false).apply {
        flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    }

    val isFalling get() = view != null

    /** 从 (x, 屏幕顶部) 掉到 targetY，到了以后调用 onArrive */
    fun drop(centerX: Int, targetY: Int, onArrive: () -> Unit) {
        if (view != null) return
        val v = SnackView(ctx, Random.nextInt(5))
        view = v
        params.x = centerX - sizePx / 2
        var y = Overlay.statusBarHeight(ctx).toFloat()
        params.y = y.toInt()
        try {
            wm.addView(v, params)
        } catch (_: Exception) {
            view = null
            onArrive()
            return
        }
        var vy = 0f
        var last = 0L
        val g = 2200f * density
        val cb = object : Choreographer.FrameCallback {
            override fun doFrame(frameTimeNanos: Long) {
                if (view !== v) return
                val dt = if (last == 0L) 0.016f else ((frameTimeNanos - last) / 1e9f).coerceIn(0f, 0.05f)
                last = frameTimeNanos
                vy += g * dt
                y += vy * dt
                v.rotation += 360f * dt
                if (y >= targetY - sizePx / 2) {
                    remove()
                    onArrive()
                    return
                }
                params.y = y.toInt()
                try { wm.updateViewLayout(v, params) } catch (_: Exception) {}
                Choreographer.getInstance().postFrameCallback(this)
            }
        }
        Choreographer.getInstance().postFrameCallback(cb)
    }

    fun remove() {
        val v = view ?: return
        view = null
        try { wm.removeView(v) } catch (_: Exception) {}
    }

    private class SnackView(ctx: Context, private val kind: Int) : View(ctx) {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val path = Path()
        private val r = RectF()

        override fun onDraw(c: Canvas) {
            val w = width.toFloat()
            val cx = w / 2
            val cy = height / 2f
            val s = w * 0.42f
            when (kind) {
                0 -> { // 曲奇
                    p.color = 0xFFE0A660.toInt(); c.drawCircle(cx, cy, s, p)
                    p.color = 0xFF6B3F22.toInt()
                    for ((dx, dy) in listOf(-0.4f to -0.3f, 0.3f to -0.35f, 0f to 0.15f, -0.35f to 0.4f, 0.4f to 0.35f)) c.drawCircle(cx + dx * s, cy + dy * s, s * 0.12f, p)
                }
                1 -> { // 苹果
                    p.color = 0xFFE5484D.toInt(); c.drawCircle(cx, cy + s * 0.1f, s * 0.9f, p)
                    p.color = 0xFF6B3F22.toInt(); c.drawRect(cx - s * 0.06f, cy - s, cx + s * 0.06f, cy - s * 0.6f, p)
                    p.color = 0xFF86CF6E.toInt(); r.set(cx, cy - s * 1.05f, cx + s * 0.6f, cy - s * 0.7f); c.drawOval(r, p)
                    p.color = 0x88FFFFFF.toInt(); c.drawCircle(cx - s * 0.35f, cy - s * 0.2f, s * 0.18f, p)
                }
                2 -> { // 草莓
                    p.color = 0xFFF0506E.toInt()
                    path.reset(); path.moveTo(cx - s, cy - s * 0.4f)
                    path.quadTo(cx, cy - s * 0.9f, cx + s, cy - s * 0.4f)
                    path.quadTo(cx + s * 0.6f, cy + s * 0.8f, cx, cy + s)
                    path.quadTo(cx - s * 0.6f, cy + s * 0.8f, cx - s, cy - s * 0.4f); c.drawPath(path, p)
                    p.color = 0xFFFFE08A.toInt()
                    for ((dx, dy) in listOf(-0.4f to -0.1f, 0.4f to -0.1f, 0f to 0.1f, -0.2f to 0.45f, 0.2f to 0.45f)) c.drawCircle(cx + dx * s, cy + dy * s, s * 0.07f, p)
                    p.color = 0xFF5FB04F.toInt(); r.set(cx - s * 0.6f, cy - s * 0.9f, cx + s * 0.6f, cy - s * 0.45f); c.drawOval(r, p)
                }
                3 -> { // 糖果
                    p.color = 0xFFFF9CC2.toInt()
                    path.reset(); path.moveTo(cx - s * 0.5f, cy); path.lineTo(cx - s * 1.05f, cy - s * 0.45f); path.lineTo(cx - s * 1.05f, cy + s * 0.45f); path.close(); c.drawPath(path, p)
                    path.reset(); path.moveTo(cx + s * 0.5f, cy); path.lineTo(cx + s * 1.05f, cy - s * 0.45f); path.lineTo(cx + s * 1.05f, cy + s * 0.45f); path.close(); c.drawPath(path, p)
                    p.color = 0xFFFF5C93.toInt(); c.drawCircle(cx, cy, s * 0.6f, p)
                    p.color = 0xAAFFFFFF.toInt(); c.drawCircle(cx - s * 0.2f, cy - s * 0.2f, s * 0.15f, p)
                }
                else -> { // 饭团
                    p.color = 0xFFFFFFFF.toInt()
                    path.reset(); path.moveTo(cx, cy - s); path.quadTo(cx + s * 1.15f, cy + s * 0.9f, cx, cy + s * 0.85f)
                    path.quadTo(cx - s * 1.15f, cy + s * 0.9f, cx, cy - s); c.drawPath(path, p)
                    p.style = Paint.Style.STROKE; p.strokeWidth = s * 0.08f; p.color = 0xFFDDDDDD.toInt(); c.drawPath(path, p); p.style = Paint.Style.FILL
                    p.color = 0xFF2F3B2F.toInt(); c.drawRect(cx - s * 0.4f, cy + s * 0.25f, cx + s * 0.4f, cy + s * 0.85f, p)
                }
            }
        }
    }
}
