class_name UI
extends RefCounted
## Palette, theme and small widget helpers shared by every screen.

const BG := Color("11161f")
const PANEL := Color("1a2230")
const PANEL_2 := Color("222c3c")
const BORDER := Color("33435a")
const ACCENT := Color("c9a24a")
const ACCENT_2 := Color("e6c56f")
const TEXT := Color("ebe5d3")
const MUTED := Color("9aa4b4")
const GOOD := Color("74c27a")
const BAD := Color("e0644f")
const WARN := Color("e3b34c")
const INFO := Color("6fa8dc")
const SEA := Color("1d3348")
const SEA_2 := Color("244058")

const BTN_H := 48


static func build_theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 18
	var panel := _box(Color(PANEL, 0.97), BORDER, 10, 1)
	panel.content_margin_left = 14
	panel.content_margin_right = 14
	panel.content_margin_top = 12
	panel.content_margin_bottom = 12
	t.set_stylebox("panel", "PanelContainer", panel)
	t.set_stylebox("panel", "Panel", panel)
	var normal := _box(PANEL_2, BORDER, 8, 1)
	var hover := _box(PANEL_2.lightened(0.08), ACCENT.darkened(0.2), 8, 1)
	var pressed := _box(ACCENT.darkened(0.45), ACCENT, 8, 2)
	var disabled := _box(Color(PANEL_2, 0.5), Color(BORDER, 0.5), 8, 1)
	var focus := _box(Color(0, 0, 0, 0), ACCENT, 8, 2)
	for b in [normal, hover, pressed, disabled]:
		b.content_margin_left = 12
		b.content_margin_right = 12
		b.content_margin_top = 6
		b.content_margin_bottom = 6
	t.set_stylebox("normal", "Button", normal)
	t.set_stylebox("hover", "Button", hover)
	t.set_stylebox("pressed", "Button", pressed)
	t.set_stylebox("hover_pressed", "Button", pressed)
	t.set_stylebox("disabled", "Button", disabled)
	t.set_stylebox("focus", "Button", focus)
	t.set_color("font_color", "Button", TEXT)
	t.set_color("font_hover_color", "Button", ACCENT_2)
	t.set_color("font_pressed_color", "Button", Color.WHITE)
	t.set_color("font_hover_pressed_color", "Button", Color.WHITE)
	t.set_color("font_disabled_color", "Button", Color(MUTED, 0.6))
	t.set_color("font_color", "Label", TEXT)
	t.set_color("default_color", "RichTextLabel", TEXT)
	var pb_bg := _box(Color("0d1219"), BORDER, 4, 1)
	var pb_fill := _box(ACCENT, ACCENT, 4, 0)
	t.set_stylebox("background", "ProgressBar", pb_bg)
	t.set_stylebox("fill", "ProgressBar", pb_fill)
	t.set_color("font_color", "ProgressBar", TEXT)
	var sep := StyleBoxLine.new()
	sep.color = BORDER
	sep.thickness = 1
	t.set_stylebox("separator", "HSeparator", sep)
	t.set_constant("separation", "HSeparator", 10)
	t.set_constant("separation", "VBoxContainer", 6)
	t.set_constant("separation", "HBoxContainer", 6)
	var sb_v := _box(Color(0, 0, 0, 0.25), Color(0, 0, 0, 0), 4, 0)
	var grab := _box(Color(MUTED, 0.5), Color(0, 0, 0, 0), 4, 0)
	for o in ["VScrollBar", "HScrollBar"]:
		t.set_stylebox("scroll", o, sb_v)
		t.set_stylebox("grabber", o, grab)
		t.set_stylebox("grabber_highlight", o, grab)
		t.set_stylebox("grabber_pressed", o, grab)
	var le := _box(Color("0d1219"), BORDER, 6, 1)
	le.content_margin_left = 8
	t.set_stylebox("normal", "LineEdit", le)
	var tip := _box(Color("0d1219"), ACCENT, 6, 1)
	tip.content_margin_left = 8
	tip.content_margin_right = 8
	tip.content_margin_top = 4
	tip.content_margin_bottom = 4
	t.set_stylebox("panel", "TooltipPanel", tip)
	return t


static func _box(bg: Color, border: Color, radius: int, bw: int) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	s.anti_aliasing = true
	return s


static func box(bg: Color, border := Color(0, 0, 0, 0), radius := 8, bw := 0) -> StyleBoxFlat:
	var s := _box(bg, border, radius, bw)
	s.content_margin_left = 10
	s.content_margin_right = 10
	s.content_margin_top = 8
	s.content_margin_bottom = 8
	return s


# ---------------------------------------------------------------- widgets

static func label(text: String, size := 18, color := TEXT, wrap := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l


static func title(text: String, size := 24) -> Label:
	return label(text, size, ACCENT_2)


static func button(text: String, cb: Callable, min_w := 0, h := BTN_H) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(min_w, h)
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(cb)
	return b


static func toggle(text: String, on: bool, cb: Callable, min_w := 0) -> Button:
	var b := button(text, cb, min_w)
	if on:
		b.add_theme_stylebox_override("normal", _box(ACCENT.darkened(0.45), ACCENT, 8, 2))
		b.add_theme_color_override("font_color", Color.WHITE)
	return b


static func hbox(sep := 6) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	return h


static func vbox(sep := 6) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	return v


static func grid(cols: int) -> GridContainer:
	var g := GridContainer.new()
	g.columns = cols
	g.add_theme_constant_override("h_separation", 12)
	g.add_theme_constant_override("v_separation", 4)
	return g


static func spacer() -> Control:
	var c := Control.new()
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return c


static func sep() -> HSeparator:
	return HSeparator.new()


static func bar(value: float, max_v: float, color: Color, h := 10, w := 0) -> ProgressBar:
	var p := ProgressBar.new()
	p.max_value = max(max_v, 0.0001)
	p.value = clampf(value, 0.0, max_v)
	p.show_percentage = false
	p.custom_minimum_size = Vector2(w, h)
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var fill := _box(color, color, 4, 0)
	p.add_theme_stylebox_override("fill", fill)
	return p


static func card(content: Control, bg := PANEL_2) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", box(bg, BORDER, 8, 1))
	p.add_child(content)
	return p


static func scroll(content: Control) -> ScrollContainer:
	var s := ScrollContainer.new()
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(content)
	return s


static func clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()


static func num(v: float, digits := 0) -> String:
	if digits == 0:
		return str(int(round(v)))
	return ("%." + str(digits) + "f") % v


static func signed(v: float, digits := 0) -> String:
	var s := num(v, digits)
	return ("+" + s) if v >= 0.0 else s


static func res_color(rid: String) -> Color:
	if GameData.resource_by_id.has(rid):
		return Color(GameData.resource_by_id[rid]["color"])
	return TEXT


const FINANCE_NAMES := {
	"tax_city": "城市税收", "tax_rural": "乡村税收", "trade_export": "出口收入", "trade_import": "进口支出",
	"upkeep_buildings": "建筑维护", "upkeep_army": "军队维护", "construction": "施工支出", "recruit": "征兵支出",
	"research": "科研投入", "reparations": "战争赔款", "claims": "领土并入", "events": "事件", "refund": "退款",
}


static func finance_name(k: String) -> String:
	return FINANCE_NAMES.get(k, k)
