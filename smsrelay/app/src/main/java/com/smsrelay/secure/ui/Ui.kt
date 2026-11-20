package com.smsrelay.secure.ui

import android.app.AlertDialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import com.smsrelay.secure.R

/** Tiny programmatic view toolkit, so the app needs no UI libraries at all. */
class Ui(val ctx: Context) {
    enum class Kind { TEXT, PASSWORD, NUMBER, PHONE, EMAIL, URL, MULTILINE, CODE }
    enum class Btn { PRIMARY, SECONDARY, DANGER }

    private val handler = Handler(Looper.getMainLooper())
    private val pendingSaves = LinkedHashMap<EditText, Runnable>()

    fun dp(v: Int): Int = (v * ctx.resources.displayMetrics.density + 0.5f).toInt()
    fun color(id: Int): Int = ctx.getColor(id)

    fun rounded(fill: Int, radiusDp: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(radiusDp).toFloat()
        if (stroke != null) setStroke(dp(1), stroke)
    }

    fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, top: Int = 0) =
        LinearLayout.LayoutParams(w, h).apply { topMargin = dp(top) }

    fun vertical(): LinearLayout = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

    fun horizontal(): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun section(parent: LinearLayout, title: String) {
        val t = TextView(ctx)
        t.text = title
        t.textSize = 13f
        t.setTextColor(color(R.color.sub))
        t.typeface = Typeface.DEFAULT_BOLD
        t.setPadding(dp(4), 0, 0, 0)
        parent.addView(t, lp(top = 20))
    }

    fun card(parent: LinearLayout): LinearLayout {
        val c = vertical()
        c.background = rounded(color(R.color.card), 16)
        c.setPadding(dp(16), dp(14), dp(16), dp(16))
        c.elevation = dp(1).toFloat()
        parent.addView(c, lp(top = 10))
        return c
    }

    fun text(
        parent: LinearLayout,
        s: CharSequence,
        size: Float = 15f,
        colorRes: Int = R.color.text,
        bold: Boolean = false,
        top: Int = 0,
    ): TextView {
        val t = TextView(ctx)
        t.text = s
        t.textSize = size
        t.setTextColor(color(colorRes))
        t.setLineSpacing(0f, 1.15f)
        if (bold) t.typeface = Typeface.DEFAULT_BOLD
        parent.addView(t, lp(top = top))
        return t
    }

    fun note(parent: LinearLayout, s: CharSequence, top: Int = 6): TextView = text(parent, s, 13f, R.color.sub, top = top)

    fun badge(parent: LinearLayout, s: String, colorRes: Int): TextView {
        val t = TextView(ctx)
        t.text = s
        t.textSize = 11f
        t.setTextColor(color(colorRes))
        t.typeface = Typeface.DEFAULT_BOLD
        val bg = rounded(color(R.color.card), 8, stroke = color(colorRes))
        t.background = bg
        t.setPadding(dp(6), dp(1), dp(6), dp(2))
        parent.addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(8) })
        return t
    }

    fun divider(parent: LinearLayout, top: Int = 12) {
        val v = View(ctx)
        v.setBackgroundColor(color(R.color.divider))
        parent.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(top) })
    }

    fun input(
        parent: LinearLayout,
        label: String,
        value: String,
        hint: String = "",
        kind: Kind = Kind.TEXT,
        onChange: (String) -> Unit,
    ): EditText {
        if (label.isNotEmpty()) text(parent, label, 13f, R.color.sub, top = 12)
        val e = EditText(ctx)
        e.setText(value)
        e.hint = hint
        e.textSize = 15f
        e.setTextColor(color(R.color.text))
        e.setHintTextColor(color(R.color.hint))
        e.background = rounded(color(R.color.field), 10, stroke = color(R.color.divider))
        e.setPadding(dp(12), dp(10), dp(12), dp(10))
        // Keep secrets away from autofill services and keyboard learning.
        e.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        e.imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING or
            (if (kind == Kind.MULTILINE) 0 else EditorInfo.IME_ACTION_DONE)
        e.inputType = when (kind) {
            Kind.TEXT -> InputType.TYPE_CLASS_TEXT
            Kind.PASSWORD -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            Kind.NUMBER -> InputType.TYPE_CLASS_NUMBER
            Kind.PHONE -> InputType.TYPE_CLASS_PHONE
            Kind.EMAIL -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            Kind.URL -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            Kind.MULTILINE -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            Kind.CODE -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        }
        if (kind == Kind.MULTILINE) {
            e.minLines = 2
            e.maxLines = 5
            e.gravity = Gravity.TOP or Gravity.START
        } else {
            // Note: do NOT call setSingleLine(true) here. A non-multiline inputType already makes
            // the field single-line, and setSingleLine would replace the password mask.
            e.maxLines = 1
        }
        if (kind == Kind.PASSWORD || kind == Kind.CODE) e.typeface = Typeface.MONOSPACE
        e.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                pendingSaves.remove(e)?.let { handler.removeCallbacks(it) }
                val r = Runnable {
                    pendingSaves.remove(e)
                    onChange(e.text.toString())
                }
                pendingSaves[e] = r
                handler.postDelayed(r, 400)
            }
        })
        if (kind == Kind.PASSWORD) {
            val row = horizontal()
            row.addView(e, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            val eye = TextView(ctx)
            eye.text = "显示"
            eye.textSize = 13f
            eye.setTextColor(color(R.color.accent))
            eye.setPadding(dp(12), dp(10), dp(4), dp(10))
            eye.setOnClickListener {
                val hidden = e.transformationMethod is PasswordTransformationMethod
                e.transformationMethod = if (hidden) null else PasswordTransformationMethod.getInstance()
                e.setSelection(e.text.length)
                eye.text = if (hidden) "隐藏" else "显示"
            }
            row.addView(eye)
            parent.addView(row, lp(top = 4))
        } else {
            parent.addView(e, lp(top = 4))
        }
        return e
    }

    /** Runs all debounced saves immediately (call from onPause). */
    fun flush() {
        val all = pendingSaves.values.toList()
        pendingSaves.clear()
        all.forEach {
            handler.removeCallbacks(it)
            it.run()
        }
    }

    fun toggle(
        parent: LinearLayout,
        title: String,
        subtitle: String?,
        checked: Boolean,
        top: Int = 4,
        onChange: (Boolean) -> Unit,
    ): Switch {
        val row = horizontal()
        val col = vertical()
        val t = TextView(ctx)
        t.text = title
        t.textSize = 16f
        t.setTextColor(color(R.color.text))
        col.addView(t)
        if (subtitle != null) {
            val st = TextView(ctx)
            st.text = subtitle
            st.textSize = 12.5f
            st.setTextColor(color(R.color.sub))
            col.addView(st, lp(top = 2))
        }
        row.addView(col, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val sw = Switch(ctx)
        sw.isChecked = checked
        sw.setOnCheckedChangeListener { _, v -> onChange(v) }
        row.addView(sw, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(12) })
        row.setOnClickListener { sw.toggle() }
        row.setPadding(0, dp(6), 0, dp(6))
        parent.addView(row, lp(top = top))
        return sw
    }

    fun button(parent: LinearLayout, label: String, kind: Btn = Btn.PRIMARY, weight: Boolean = false, onClick: () -> Unit): Button {
        val b = Button(ctx)
        b.text = label
        b.isAllCaps = false
        b.textSize = 14.5f
        b.stateListAnimator = null
        b.minHeight = dp(44)
        b.minimumHeight = dp(44)
        b.setPadding(dp(14), 0, dp(14), 0)
        val (bg, fg) = when (kind) {
            Btn.PRIMARY -> R.color.accent to R.color.on_accent
            Btn.SECONDARY -> R.color.accent_soft to R.color.accent
            Btn.DANGER -> R.color.err_soft to R.color.err
        }
        b.setTextColor(color(fg))
        b.background = RippleDrawable(ColorStateList.valueOf(color(R.color.ripple)), rounded(color(bg), 12), null)
        b.setOnClickListener { onClick() }
        if (weight) {
            parent.addView(b, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                leftMargin = if (parent.childCount > 0) dp(8) else 0
            })
        } else if (parent.orientation == LinearLayout.HORIZONTAL) {
            parent.addView(b, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = if (parent.childCount > 0) dp(8) else 0
            })
        } else {
            parent.addView(b, lp(top = 12))
        }
        return b
    }

    fun buttonRow(parent: LinearLayout, top: Int = 12): LinearLayout {
        val row = horizontal()
        parent.addView(row, lp(top = top))
        return row
    }

    fun picker(parent: LinearLayout, label: String, options: List<String>, selected: Int, onPick: (Int) -> Unit): TextView {
        text(parent, label, 13f, R.color.sub, top = 12)
        val t = TextView(ctx)
        var current = selected.coerceIn(0, options.size - 1)
        t.text = options[current] + "   ▾"
        t.textSize = 15f
        t.setTextColor(color(R.color.text))
        t.background = rounded(color(R.color.field), 10, stroke = color(R.color.divider))
        t.setPadding(dp(12), dp(11), dp(12), dp(11))
        t.setOnClickListener {
            AlertDialog.Builder(ctx)
                .setTitle(label)
                .setSingleChoiceItems(options.toTypedArray(), current) { d, which ->
                    current = which
                    t.text = options[which] + "   ▾"
                    d.dismiss()
                    onPick(which)
                }
                .setNegativeButton("取消", null)
                .show()
        }
        parent.addView(t, lp(top = 4))
        return t
    }

    /** A status line: text on the left, optional action on the right. */
    fun statusRow(parent: LinearLayout, ok: Boolean, label: String, action: String? = null, onAction: (() -> Unit)? = null) {
        val row = horizontal()
        val t = TextView(ctx)
        t.text = (if (ok) "✅  " else "⚠️  ") + label
        t.textSize = 14.5f
        t.setTextColor(color(if (ok) R.color.text else R.color.warn))
        row.addView(t, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (!ok && action != null && onAction != null) {
            val a = TextView(ctx)
            a.text = action
            a.textSize = 14f
            a.typeface = Typeface.DEFAULT_BOLD
            a.setTextColor(color(R.color.accent))
            a.setPadding(dp(12), dp(8), dp(4), dp(8))
            a.setOnClickListener { onAction() }
            row.addView(a)
        }
        row.setPadding(0, dp(4), 0, dp(4))
        parent.addView(row, lp(top = 2))
    }
}
