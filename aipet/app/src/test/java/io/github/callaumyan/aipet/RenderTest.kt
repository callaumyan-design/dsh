package io.github.callaumyan.aipet

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Looper
import android.view.ContextThemeWrapper
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import io.github.callaumyan.aipet.chat.ChatEngine
import io.github.callaumyan.aipet.chat.ChatMsg
import io.github.callaumyan.aipet.pet.ChatPanel
import io.github.callaumyan.aipet.pet.PetPalette
import io.github.callaumyan.aipet.pet.PetView
import io.github.callaumyan.aipet.ui.MainActivity
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowSystemClock
import java.io.File
import java.time.Duration

/**
 * 不是功能测试，而是把桌宠和各个界面真实地“画”成 PNG（在 app/build/renders/ 下），
 * 方便在没有手机的情况下检查长相，也顺便确认绘制代码不会崩溃。
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w393dp-h852dp-xxhdpi")
class RenderTest {
    private val out = File("build/renders").apply { mkdirs() }
    private val app get() = ApplicationProvider.getApplicationContext<App>()
    private val themed get() = ContextThemeWrapper(app, R.style.Theme_AiPet)

    private fun save(bmp: Bitmap, name: String) {
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun measure(view: View, w: Int, h: Int?) {
        val ws = View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY)
        val hs = if (h == null) View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        else View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY)
        view.measure(ws, hs)
        view.layout(0, 0, view.measuredWidth, view.measuredHeight)
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun advance(ms: Long) = ShadowSystemClock.advanceBy(Duration.ofMillis(ms))

    /** 让动画跑一会儿（粒子、眨眼等需要时间推进），返回最后一帧。 */
    private fun petFrame(pet: PetView, runMs: Long, canvas: Canvas, x: Float, y: Float) {
        var t = 0L
        while (t < runMs) {
            advance(50); t += 50
            val scratch = Bitmap.createBitmap(pet.measuredWidth, pet.measuredHeight, Bitmap.Config.ARGB_8888)
            pet.draw(Canvas(scratch))
        }
        canvas.save()
        canvas.translate(x, y)
        pet.draw(canvas)
        canvas.restore()
    }

    @Test
    fun petSheet() {
        val modes = PetView.Mode.entries
        val body = 150f
        val cellW = (body * PetView.W_RATIO).toInt()
        val cellH = (body * PetView.H_RATIO).toInt() + 40
        val sheet = Bitmap.createBitmap(cellW * modes.size, cellH * PetPalette.all.size, Bitmap.Config.ARGB_8888)
        val c = Canvas(sheet)
        c.drawColor(Color.rgb(250, 247, 248))
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 26f; color = Color.DKGRAY; textAlign = Paint.Align.CENTER }
        PetPalette.all.forEachIndexed { row, pal ->
            modes.forEachIndexed { col, mode ->
                val pet = PetView(themed)
                pet.bodySize = body
                pet.palette = pal
                pet.facing = 1
                measure(pet, (body * PetView.W_RATIO).toInt(), (body * PetView.H_RATIO).toInt())
                when (mode) {
                    PetView.Mode.HAPPY -> pet.flash(PetView.Mode.HAPPY, 60_000)
                    else -> pet.baseMode = mode
                }
                val run = when (mode) {
                    PetView.Mode.SLEEP -> 3000L
                    PetView.Mode.HAPPY -> 1000L
                    PetView.Mode.WALK -> 330L
                    PetView.Mode.TALKING -> 140L
                    else -> 600L
                }
                petFrame(pet, run, c, (col * cellW).toFloat(), (row * cellH).toFloat())
                if (row == 0) c.drawText(mode.name, col * cellW + cellW / 2f, (cellH - 10).toFloat(), label)
            }
        }
        save(sheet, "pet_sheet")
    }

    @Test
    fun mainScreen() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        idle()
        val content = activity.findViewById<View>(R.id.content)
        val w = activity.resources.displayMetrics.widthPixels
        measure(content, w, null)
        val bmp = Bitmap.createBitmap(content.measuredWidth, content.measuredHeight, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(activity.getColor(R.color.page_bg))
        content.draw(c)
        save(bmp, "main_screen")
    }

    @Suppress("UNCHECKED_CAST")
    @Test
    fun chatPanelAndHomeScreen() {
        val msgsField = ChatEngine::class.java.getDeclaredField("_messages").apply { isAccessible = true }
        val flow = msgsField.get(app.chat) as MutableStateFlow<List<ChatMsg>>
        flow.value = listOf(
            ChatMsg(1, false, "主人好呀～我是团子！"),
            ChatMsg(2, true, "今天好累啊"),
            ChatMsg(3, false, "辛苦啦～要不要先喝口水、伸个懒腰？我陪你一起歇五分钟嘛 (｡･ω･｡)"),
            ChatMsg(4, true, "明天要考试了，有点紧张"),
            ChatMsg(5, false, "紧张说明你很在乎呀。今晚把重点再过一遍，然后早点睡，睡饱了脑子才转得快！我给你加油～"),
        )
        app.prefs.setApiKey(app.prefs.providerId, "sk-test")

        val dm = app.resources.displayMetrics
        val sw = dm.widthPixels
        val sh = dm.heightPixels
        val wm = app.getSystemService(WindowManager::class.java)

        // ---- 聊天窗口（叠在一个假装的 App 上）----
        val panel = ChatPanel(themed, wm, {}, {})
        panel.show()
        idle()
        val root = ChatPanel::class.java.getDeclaredField("root").apply { isAccessible = true }.get(panel) as View
        measure(root, sw, sh)
        idle()
        measure(root, sw, sh)
        val chatBmp = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
        val c1 = Canvas(chatBmp)
        drawFakeHome(c1, sw, sh)
        root.draw(c1)
        save(chatBmp, "chat_panel")
        panel.dismiss()

        // ---- 桌面上的桌宠 + 气泡 ----
        val home = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
        val c2 = Canvas(home)
        drawFakeHome(c2, sw, sh)
        val pet = PetView(themed)
        pet.bodySize = 72 * dm.density
        pet.palette = PetPalette.get(1)
        measure(pet, (pet.bodySize * PetView.W_RATIO).toInt(), (pet.bodySize * PetView.H_RATIO).toInt())
        pet.baseMode = PetView.Mode.TALKING
        val px = sw - pet.measuredWidth - (16 * dm.density)
        val py = sh * 0.62f
        petFrame(pet, 200, c2, px, py)

        val bubble = LayoutInflater.from(themed).inflate(R.layout.overlay_bubble, null)
        bubble.findViewById<TextView>(R.id.bubble_text).apply {
            text = "主人好呀～今天也要元气满满哦！"
            maxWidth = (260 * dm.density).toInt()
        }
        bubble.measure(
            View.MeasureSpec.makeMeasureSpec((260 * dm.density).toInt(), View.MeasureSpec.AT_MOST),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        bubble.layout(0, 0, bubble.measuredWidth, bubble.measuredHeight)
        val bx = (px + pet.measuredWidth / 2f - bubble.measuredWidth / 2f).coerceAtMost(sw - bubble.measuredWidth - 8 * dm.density)
        val by = py + pet.measuredHeight * 0.18f - bubble.measuredHeight
        c2.save()
        c2.translate(bx, by)
        bubble.draw(c2)
        c2.restore()
        save(home, "home_screen")
    }

    /** 画一个假的手机桌面当背景 */
    private fun drawFakeHome(c: Canvas, w: Int, h: Int) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), Color.rgb(140, 170, 230), Color.rgb(235, 175, 200), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
        p.shader = null
        val d = app.resources.displayMetrics.density
        val size = 56 * d
        val gap = (w - 4 * size) / 5f
        val colors = intArrayOf(0xFFFFFFFF.toInt(), 0xFF7CC4A4.toInt(), 0xFFF6C26B.toInt(), 0xFF8AA6F0.toInt(), 0xFFEF8C8C.toInt())
        for (r in 0 until 5) for (col in 0 until 4) {
            p.color = colors[(r * 4 + col) % colors.size]
            p.alpha = 230
            val x = gap + col * (size + gap)
            val y = 120 * d + r * (size + 40 * d)
            c.drawRoundRect(RectF(x, y, x + size, y + size), 16 * d, 16 * d, p)
        }
    }
}
