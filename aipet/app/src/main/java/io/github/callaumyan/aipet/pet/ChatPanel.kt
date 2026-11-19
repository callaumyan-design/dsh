package io.github.callaumyan.aipet.pet

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.util.AttributeSet
import android.view.Gravity
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import io.github.callaumyan.aipet.App
import io.github.callaumyan.aipet.R
import io.github.callaumyan.aipet.chat.ChatMsg
import io.github.callaumyan.aipet.chat.PetEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlin.math.max

/** 能收到“返回键”的根布局（悬浮窗没有 Activity，要自己处理返回键）。 */
class BackAwareFrameLayout @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) :
    FrameLayout(context, attrs) {
    var onBack: (() -> Unit)? = null

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) onBack?.invoke()
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}

/**
 * 悬浮聊天窗口：从屏幕底部弹出，不会离开你正在用的 App。
 * 用悬浮窗而不是普通页面，是为了在小米/华为等手机上不需要额外的“后台弹出界面”权限。
 */
class ChatPanel(
    private val ctx: Context,
    private val wm: WindowManager,
    private val openSettings: () -> Unit,
    private val onClosed: () -> Unit,
) {
    private val app = App.instance
    private val chat = app.chat
    private var root: BackAwareFrameLayout? = null
    private var scope: CoroutineScope? = null
    private var miniPet: PetView? = null

    val isShowing get() = root != null

    fun show() {
        if (root != null) return
        val view = LayoutInflater.from(ctx).inflate(R.layout.overlay_chat, null) as BackAwareFrameLayout
        root = view
        val panel = view.findViewById<LinearLayout>(R.id.panel)
        val list = view.findViewById<RecyclerView>(R.id.list)
        val input = view.findViewById<EditText>(R.id.input)
        val send = view.findViewById<ImageButton>(R.id.send)
        val title = view.findViewById<TextView>(R.id.title)
        val status = view.findViewById<TextView>(R.id.status)
        val empty = view.findViewById<TextView>(R.id.empty)
        val setup = view.findViewById<TextView>(R.id.setup_hint)
        val pet = view.findViewById<PetView>(R.id.mini_pet)
        miniPet = pet

        val density = ctx.resources.displayMetrics.density
        pet.bodySize = 34 * density
        pet.palette = PetPalette.get(app.prefs.colorIndex)
        title.text = app.prefs.petName

        // 面板从屏幕 30% 的高度开始往下铺
        val screen = Overlay.screenSize(wm)
        (panel.layoutParams as FrameLayout.LayoutParams).topMargin = (screen.y * 0.28f).toInt()

        view.onBack = { dismiss() }
        view.setOnClickListener { dismiss() } // 点上面的半透明区域关闭
        panel.setOnClickListener { /* 吃掉点击，避免误关 */ }
        view.findViewById<View>(R.id.close).setOnClickListener { dismiss() }
        view.findViewById<View>(R.id.settings).setOnClickListener {
            dismiss()
            openSettings()
        }
        setup.setOnClickListener {
            dismiss()
            openSettings()
        }

        val adapter = MsgAdapter()
        val lm = LinearLayoutManager(ctx).apply { stackFromEnd = true }
        list.layoutManager = lm
        list.adapter = adapter

        fun submit() {
            val text = input.text.toString()
            if (text.isBlank()) return
            chat.send(text)
            input.setText("")
        }
        send.setOnClickListener {
            if (chat.busy.value) chat.cancel() else submit()
        }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                if (!chat.busy.value) submit()
                true
            } else false
        }

        // 键盘弹出时把面板顶上去
        view.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val ime = insets.getInsets(WindowInsets.Type.ime())
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                v.setPadding(0, bars.top, 0, max(ime.bottom, bars.bottom))
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(0, insets.systemWindowInsetTop, 0, insets.systemWindowInsetBottom)
            }
            insets
        }

        val params = Overlay.baseParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, focusable = true,
        ).apply {
            @Suppress("DEPRECATION")
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) fitInsetsTypes = 0
        }
        try {
            wm.addView(view, params)
        } catch (e: Exception) {
            root = null
            Toast.makeText(ctx, "打不开聊天窗口：${e.message}", Toast.LENGTH_LONG).show()
            onClosed()
            return
        }

        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = s
        s.launch {
            chat.messages.combine(chat.busy) { m, b -> m to b }.collect { (msgs, busy) ->
                adapter.submitList(msgs) {
                    if (msgs.isNotEmpty()) list.scrollToPosition(msgs.size - 1)
                }
                empty.visibility = if (msgs.isEmpty()) View.VISIBLE else View.GONE
                send.setImageResource(if (busy) R.drawable.ic_stop else R.drawable.ic_send)
                send.contentDescription = if (busy) "停止" else "发送"
                status.text = if (busy) "正在想……" else "在线 · 陪着你"
                if (!busy && pet.face == Face.THINK) pet.face = Face.NORMAL
            }
        }
        s.launch {
            chat.events.collect { ev ->
                when (ev) {
                    PetEvent.Thinking -> { pet.face = Face.THINK; pet.talking = false }
                    is PetEvent.Streaming -> { pet.face = Face.NORMAL; pet.talking = true }
                    is PetEvent.Said -> {
                        pet.talking = false
                        pet.face = Face.NORMAL
                        pet.flash(Face.HAPPY, 1200)
                    }
                    is PetEvent.Failed -> { pet.talking = false; pet.face = Face.SAD }
                }
            }
        }
        val p = app.prefs.provider
        setup.visibility = if (app.prefs.apiKey(p.id).isBlank()) View.VISIBLE else View.GONE

        // 自动弹出键盘
        input.requestFocus()
        input.postDelayed({
            val imm = ctx.getSystemService(InputMethodManager::class.java)
            imm?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }, 250)
    }

    fun dismiss() {
        val v = root ?: return
        root = null
        scope?.cancel()
        scope = null
        miniPet?.running = false
        miniPet = null
        try {
            val imm = ctx.getSystemService(InputMethodManager::class.java)
            imm?.hideSoftInputFromWindow(v.windowToken, 0)
            wm.removeView(v)
        } catch (_: Exception) {
        }
        onClosed()
    }

    private inner class MsgAdapter : ListAdapter<ChatMsg, MsgHolder>(DIFF) {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
            MsgHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_msg, parent, false))

        override fun onBindViewHolder(holder: MsgHolder, position: Int) = holder.bind(getItem(position))
    }

    private inner class MsgHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val text: TextView = itemView.findViewById(R.id.msg_text)

        fun bind(m: ChatMsg) {
            val lp = text.layoutParams as FrameLayout.LayoutParams
            lp.gravity = if (m.fromUser) Gravity.END else Gravity.START
            text.layoutParams = lp
            text.text = when {
                m.pending && m.text.isEmpty() -> "……"
                else -> m.text
            }
            text.setBackgroundResource(
                when {
                    m.error -> R.drawable.bubble_error
                    m.fromUser -> R.drawable.bubble_me
                    else -> R.drawable.bubble_pet
                }
            )
            text.setTextColor(
                ctx.getColor(if (m.fromUser) R.color.bubble_me_text else R.color.bubble_pet_text)
            )
            text.setOnLongClickListener {
                val cm = ctx.getSystemService(ClipboardManager::class.java)
                cm?.setPrimaryClip(ClipData.newPlainText("chat", m.text))
                Toast.makeText(ctx, "已复制", Toast.LENGTH_SHORT).show()
                true
            }
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<ChatMsg>() {
            override fun areItemsTheSame(a: ChatMsg, b: ChatMsg) = a.id == b.id
            override fun areContentsTheSame(a: ChatMsg, b: ChatMsg) = a == b
        }
    }
}
