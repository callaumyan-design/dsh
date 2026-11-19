package io.github.callaumyan.aipet.pet

import android.content.Context
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import io.github.callaumyan.aipet.R

/** 桌宠头顶的对话气泡（一个独立的小悬浮窗）。点气泡会打开聊天窗口。 */
class BubbleWindow(private val ctx: Context, private val wm: WindowManager, onClick: () -> Unit) {
    private val root: View = LayoutInflater.from(ctx).inflate(R.layout.overlay_bubble, null)
    private val textView: TextView = root.findViewById(R.id.bubble_text)
    private val tailDown: View = root.findViewById(R.id.bubble_tail)
    private val params = Overlay.baseParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, focusable = false,
    )
    private val handler = Handler(Looper.getMainLooper())
    private val hideRunnable = Runnable { hide() }
    private var attached = false
    private var anchor = Rect()

    val isShowing get() = attached

    init {
        root.setOnClickListener {
            hide()
            onClick()
        }
    }

    /**
     * 显示一句话。[durationMs] <= 0 表示一直显示（比如 AI 正在一个字一个字地回复）。
     */
    fun show(text: String, petBounds: Rect, durationMs: Long) {
        textView.text = text
        anchor.set(petBounds)
        handler.removeCallbacks(hideRunnable)
        layout()
        if (durationMs > 0) handler.postDelayed(hideRunnable, durationMs)
    }

    fun follow(petBounds: Rect) {
        if (!attached) return
        anchor.set(petBounds)
        layout()
    }

    fun hide() {
        handler.removeCallbacks(hideRunnable)
        if (attached) {
            try {
                wm.removeView(root)
            } catch (_: Exception) {
            }
            attached = false
        }
    }

    private fun layout() {
        val screen = Overlay.screenSize(wm)
        val density = ctx.resources.displayMetrics.density
        val margin = (8 * density).toInt()
        val maxW = (260 * density).toInt().coerceAtMost(screen.x - 2 * margin)
        textView.maxWidth = maxW

        // 先假设气泡放在桌宠上方
        tailDown.visibility = View.VISIBLE
        root.measure(
            View.MeasureSpec.makeMeasureSpec(maxW, View.MeasureSpec.AT_MOST),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        var w = root.measuredWidth
        var h = root.measuredHeight
        val petH = anchor.height()
        // 桌宠窗口上面留了一些空白（给跳跃用），气泡贴近头顶
        var y = anchor.top + (petH * 0.2f).toInt() - h
        if (y < Overlay.statusBarHeight(ctx)) {
            // 上面放不下，就放到桌宠下面
            tailDown.visibility = View.GONE
            root.measure(
                View.MeasureSpec.makeMeasureSpec(maxW, View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            )
            w = root.measuredWidth
            h = root.measuredHeight
            y = anchor.bottom - (petH * 0.04f).toInt()
        }
        val x = (anchor.centerX() - w / 2).coerceIn(margin, (screen.x - w - margin).coerceAtLeast(margin))
        // 气泡被屏幕边缘挡住往旁边挪时，小尾巴仍然指向桌宠
        val maxShift = (w / 2 - 20 * density).coerceAtLeast(0f)
        tailDown.translationX = (anchor.centerX() - (x + w / 2f)).coerceIn(-maxShift, maxShift)
        params.x = x
        params.y = y.coerceIn(0, (screen.y - h).coerceAtLeast(0))
        try {
            if (attached) wm.updateViewLayout(root, params) else {
                wm.addView(root, params)
                attached = true
            }
        } catch (_: Exception) {
            attached = false
        }
    }
}
