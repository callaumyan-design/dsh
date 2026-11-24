package com.callaum.antigravity;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.widget.TextView;

/** 贴在屏幕边上的小圆按钮，点一下打开菜单，按住可以拖到别的位置（位置会记住）。 */
@SuppressLint("ViewConstructor")
final class FloatingMenuButton extends TextView {
    private final SharedPreferences prefs;
    private final int touchSlop;
    private final int margin;
    private float downRawX;
    private float downRawY;
    private float startX;
    private float startY;
    private boolean dragging;

    FloatingMenuButton(Context context, SharedPreferences prefs) {
        super(context);
        this.prefs = prefs;
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        float d = context.getResources().getDisplayMetrics().density;
        margin = Math.round(6 * d);
        int size = Math.round(38 * d);
        setLayoutParams(new ViewGroup.LayoutParams(size, size));
        setGravity(Gravity.CENTER);
        setText("中");
        setTextColor(Color.WHITE);
        setTextSize(15);
        setTypeface(Typeface.DEFAULT_BOLD);
        setContentDescription("菜单");
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0x99202124);
        bg.setStroke(Math.max(1, Math.round(d)), 0x55FFFFFF);
        setBackground(bg);
        setElevation(6 * d);
        setAlpha(0.8f);
    }

    /** 父视图大小确定或变化后，按记住的位置摆放。 */
    void place() {
        View parent = (View) getParent();
        if (parent == null || parent.getWidth() == 0 || getWidth() == 0) return;
        boolean right = prefs.getBoolean("fab_right", true);
        float fraction = prefs.getFloat("fab_y", 0.3f);
        float maxY = parent.getHeight() - getHeight() - margin;
        setX(right ? parent.getWidth() - getWidth() - margin : margin);
        setY(clamp(fraction * parent.getHeight(), margin, maxY));
    }

    @SuppressLint("ClickableViewAccessibility")
    @Override
    public boolean onTouchEvent(MotionEvent e) {
        View parent = (View) getParent();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = e.getRawX();
                downRawY = e.getRawY();
                startX = getX();
                startY = getY();
                dragging = false;
                setAlpha(1f);
                return true;
            case MotionEvent.ACTION_MOVE:
                float dx = e.getRawX() - downRawX;
                float dy = e.getRawY() - downRawY;
                if (!dragging && Math.hypot(dx, dy) > touchSlop) dragging = true;
                if (dragging && parent != null) {
                    setX(clamp(startX + dx, margin, parent.getWidth() - getWidth() - margin));
                    setY(clamp(startY + dy, margin, parent.getHeight() - getHeight() - margin));
                }
                return true;
            case MotionEvent.ACTION_UP:
                setAlpha(0.8f);
                if (!dragging) {
                    performClick();
                } else if (parent != null) {
                    boolean right = getX() + getWidth() / 2f > parent.getWidth() / 2f;
                    prefs.edit()
                            .putBoolean("fab_right", right)
                            .putFloat("fab_y", getY() / Math.max(1, parent.getHeight()))
                            .apply();
                    animate().x(right ? parent.getWidth() - getWidth() - margin : margin).setDuration(150).start();
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                setAlpha(0.8f);
                if (dragging) place();
                return true;
            default:
                return super.onTouchEvent(e);
        }
    }

    @Override
    public boolean performClick() {
        return super.performClick();
    }

    private static float clamp(float v, float min, float max) {
        return Math.max(min, Math.min(v, Math.max(min, max)));
    }
}
