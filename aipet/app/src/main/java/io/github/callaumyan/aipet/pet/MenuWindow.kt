package io.github.callaumyan.aipet.pet

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import io.github.callaumyan.aipet.R

/** 双击桌宠弹出的小菜单：聊天 / 喂零食 / 哄睡 / 收起 */
class MenuWindow(private val ctx: Context, private val wm: WindowManager) {
    data class Item(val emoji: String, val label: String, val action: () -> Unit)

    private val density = ctx.resources.displayMetrics.density
    private val handler = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private val hideRunnable = Runnable { hide() }

    val isShowing get() = root != null

    @SuppressLint("ClickableViewAccessibility")
    fun show(items: List<Item>, petBounds: Rect) {
        hide()
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundResource(R.drawable.float_bubble)
            elevation = 4 * density
            val p = (4 * density).toInt()
            setPadding(p, p, p, p)
        }
        for (item in items) {
            val tv = TextView(ctx).apply {
                text = "${item.emoji}\n${item.label}"
                gravity = Gravity.CENTER
                textSize = 12f
                setTextColor(ctx.getColor(R.color.float_bubble_text))
                val p = (8 * density).toInt()
                setPadding(p, (6 * density).toInt(), p, (6 * density).toInt())
                minWidth = (52 * density).toInt()
                isClickable = true
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener {
                    hide()
                    item.action()
                }
            }
            row.addView(tv)
        }
        row.setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) hide()
            false
        }
        val params = Overlay.baseParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, focusable = false,
        ).apply { flags = flags or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH }

        row.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        val screen = Overlay.screenSize(wm)
        val w = row.measuredWidth
        val h = row.measuredHeight
        val margin = (8 * density).toInt()
        params.x = (petBounds.centerX() - w / 2).coerceIn(margin, (screen.x - w - margin).coerceAtLeast(margin))
        var y = petBounds.top + (petBounds.height() * 0.15f).toInt() - h
        if (y < Overlay.statusBarHeight(ctx)) y = petBounds.bottom
        params.y = y.coerceIn(0, (screen.y - h).coerceAtLeast(0))
        try {
            wm.addView(row, params)
            root = row
            handler.postDelayed(hideRunnable, 5_000)
        } catch (_: Exception) {
            root = null
        }
    }

    fun hide() {
        handler.removeCallbacks(hideRunnable)
        val r = root ?: return
        root = null
        try { wm.removeView(r) } catch (_: Exception) {}
    }
}
