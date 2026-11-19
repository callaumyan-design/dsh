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
import io.github.callaumyan.aipet.pet.Effect
import io.github.callaumyan.aipet.pet.Face
import io.github.callaumyan.aipet.pet.PetPalette
import io.github.callaumyan.aipet.pet.PetView
import io.github.callaumyan.aipet.pet.Pose
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

    private fun newPet(body: Float, pal: Int = 1): PetView {
        val pet = PetView(themed)
        pet.bodySize = body
        pet.palette = PetPalette.get(pal)
        measure(pet, (body * PetView.W_RATIO).toInt(), (body * PetView.H_RATIO).toInt())
        return pet
    }

    private fun sheet(name: String, cells: List<Pair<String, (PetView) -> Long>>, cols: Int, body: Float = 150f) {
        val cellW = (body * PetView.W_RATIO).toInt()
        val cellH = (body * PetView.H_RATIO).toInt() + 44
        val rows = (cells.size + cols - 1) / cols
        val bmp = Bitmap.createBitmap(cellW * cols, cellH * rows, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.rgb(250, 247, 248))
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 28f; color = Color.DKGRAY; textAlign = Paint.Align.CENTER }
        cells.forEachIndexed { i, (title, setup) ->
            val pet = newPet(body)
            val run = setup(pet)
            val x = (i % cols) * cellW.toFloat()
            val y = (i / cols) * cellH.toFloat()
            petFrame(pet, run, c, x, y)
            c.drawText(title, x + cellW / 2f, y + cellH - 12, label)
        }
        save(bmp, name)
    }

    @Test
    fun faceSheet() {
        val names = mapOf(
            Face.NORMAL to "平常", Face.HAPPY to "开心", Face.LOVE to "喜欢", Face.BLISS to "被摸摸",
            Face.SHY to "害羞", Face.ANGRY to "生气", Face.ANNOYED to "不耐烦", Face.SAD to "难过",
            Face.WORRIED to "担心", Face.DIZZY to "晕了", Face.SURPRISED to "吓一跳", Face.SLEEPY to "困",
            Face.SLEEP to "睡着", Face.PAIN to "疼", Face.EAT to "吃东西", Face.THINK to "想事情",
        )
        sheet("faces", Face.entries.map { f ->
            names.getValue(f) to { p: PetView ->
                p.face = f
                if (f == Face.SLEEP) p.pose = Pose.LIE
                if (f == Face.EAT) { p.pose = Pose.SIT; p.effect(Effect.CRUMBS) }
                if (f == Face.ANGRY) p.effect(Effect.STEAM)
                if (f == Face.WORRIED) p.effect(Effect.SWEAT)
                when (f) { Face.SLEEP -> 3000L; Face.LOVE, Face.BLISS -> 1200L; else -> 500L }
            }
        }, cols = 4)
    }

    @Test
    fun poseSheet() {
        sheet("poses", listOf(
            "走路" to { p: PetView -> p.pose = Pose.WALK; 330L },
            "坐着" to { p: PetView -> p.pose = Pose.SIT; 600L },
            "被拎起来" to { p: PetView -> p.pose = Pose.HELD; p.face = Face.SURPRISED; p.effect(Effect.EXCLAIM); 300L },
            "被扔出去" to { p: PetView -> p.pose = Pose.AIR; p.velX = 2500f; p.velY = -800f; p.spinSpeed = 300f; p.face = Face.SURPRISED; 300L },
            "粘在左墙" to { p: PetView -> p.pose = Pose.CLING_LEFT; p.face = Face.HAPPY; 400L },
            "粘在右墙" to { p: PetView -> p.pose = Pose.CLING_RIGHT; 400L },
            "跳舞" to { p: PetView -> p.pose = Pose.DANCE; p.face = Face.HAPPY; p.effect(Effect.NOTES); 700L },
            "吃电" to { p: PetView -> p.pose = Pose.SIT; p.face = Face.EAT; p.effect(Effect.BOLTS); 450L },
        ), cols = 4)
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
        pet.pose = Pose.CLING_RIGHT
        pet.face = Face.HAPPY
        val px = sw - pet.measuredWidth + (pet.measuredWidth / 2f - 0.445f * pet.bodySize)
        val py = sh * 0.42f
        petFrame(pet, 300, c2, px, py)

        val bubble = LayoutInflater.from(themed).inflate(R.layout.overlay_bubble, null)
        bubble.findViewById<TextView>(R.id.bubble_text).apply {
            text = "嘿嘿，我会爬墙哦"
            maxWidth = (260 * dm.density).toInt()
        }
        bubble.measure(
            View.MeasureSpec.makeMeasureSpec((260 * dm.density).toInt(), View.MeasureSpec.AT_MOST),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        bubble.layout(0, 0, bubble.measuredWidth, bubble.measuredHeight)
        val bx = (px + pet.measuredWidth / 2f - bubble.measuredWidth / 2f).coerceAtMost(sw - bubble.measuredWidth - 8 * dm.density)
        // 地上还有一只在睡觉的（演示：锁屏久了回来时看到的样子）
        val sleeper = newPet(72 * dm.density, pal = 3)
        sleeper.pose = Pose.LIE
        sleeper.face = Face.SLEEP
        petFrame(sleeper, 3000, c2, 40 * dm.density, sh - 48 * dm.density - sleeper.measuredHeight + 0.085f * sleeper.bodySize)
        val by = py + pet.measuredHeight * 0.2f - bubble.measuredHeight
        val maxShift = bubble.measuredWidth / 2f - 20 * dm.density
        bubble.findViewById<View>(R.id.bubble_tail).translationX =
            (px + pet.measuredWidth / 2f - (bx + bubble.measuredWidth / 2f)).coerceIn(-maxShift, maxShift)
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
