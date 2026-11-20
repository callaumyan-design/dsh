class_name WorldMapView
extends MapCanvas
## Strategic map: provinces, roads with capacities, armies, sieges and paths.

signal province_tapped(pid: String)
signal army_tapped(aid: int)

var map_mode := "political"
var selected_province := ""
var selected_army := 0
var _token_rects := {}   # army id -> Rect2 (world space)


func _ready() -> void:
	super._ready()
	var scen := GameData.scenario()
	content_size = Vector2(scen["map_size"][0], scen["map_size"][1])
	min_zoom = 0.3
	max_zoom = 3.0
	tapped.connect(_on_tap)


func _on_tap(w: Vector2) -> void:
	var s: GameState = Session.state
	if s == null:
		return
	var sp := world_to_screen(w)
	for aid in _token_rects.keys():
		if (_token_rects[aid] as Rect2).grow(6.0).has_point(sp):
			army_tapped.emit(aid)
			return
	for pid in s.province_order:
		if Geometry2D.is_point_in_polygon(w, s.provinces[pid].polygon):
			province_tapped.emit(pid)
			return
	province_tapped.emit("")


func _font() -> Font:
	return get_theme_default_font()


func _province_color(s: GameState, p: Province) -> Color:
	var owner: Nation = s.nations[p.owner]
	match map_mode:
		"resource":
			if p.rural_output.is_empty():
				return Color("4b5a48")
			var best := ""
			var bv := 0.0
			for r in p.rural_output.keys():
				var v := float(p.rural_output[r]) * GameData.res_price(r)
				if v > bv:
					bv = v
					best = r
			return UI.res_color(best).lerp(Color("4b5a48"), 0.35)
		"economy":
			var tot := 0.0
			for r in p.stock.keys():
				tot += float(p.stock[r]) * GameData.res_price(r)
			var c := s.city_of(p.id)
			var v2 := p.pop / 900.0 + (c.pop / 600.0 if c else 0.0)
			return Color("2d3b2a").lerp(Color("d8c35a"), clampf(v2 * 0.6 + tot / 2500.0, 0.0, 1.0))
		"military":
			var pw := 0.0
			for a in s.armies_in(p.id):
				pw += MilitarySystem.army_power(s, a)
			var base := Color("394236")
			if s.nations[p.controller].is_active() and s.player_nation != p.controller and s.at_war(s.player_nation, p.controller):
				base = Color("5a2f2a")
			return base.lerp(Color("e05a4a"), clampf(pw / 60.0, 0.0, 0.8))
	return owner.color.darkened(0.15) if not owner.is_native else Color("6e6a55")


func _draw() -> void:
	var s: GameState = Session.state
	draw_rect(Rect2(Vector2.ZERO, size), UI.SEA)
	if s == null:
		return
	# --- world-space geometry
	draw_set_transform(offset, 0.0, Vector2(zoom, zoom))
	for i in range(0, int(content_size.y) + 400, 50):
		var y := float(i) - 200.0
		draw_line(Vector2(-600, y), Vector2(content_size.x + 600, y + 14), Color(UI.SEA_2, 0.45), 1.5 / zoom)
	for pid in s.province_order:
		var p: Province = s.provinces[pid]
		draw_colored_polygon(p.polygon, _province_color(s, p))
		if p.is_occupied() and map_mode == "political":
			_draw_hatch(p.polygon, s.nations[p.controller].color.lightened(0.1))
		if not p.claim.is_empty():
			_draw_hatch(p.polygon, Color(s.nations[p.claim["nation"]].color, 0.5))
	for pid in s.province_order:
		var poly: PackedVector2Array = s.provinces[pid].polygon.duplicate()
		poly.append(poly[0])
		draw_polyline(poly, Color(0, 0, 0, 0.55), 3.0 / zoom, true)
	if selected_province != "" and s.provinces.has(selected_province):
		var sp: PackedVector2Array = s.provinces[selected_province].polygon.duplicate()
		sp.append(sp[0])
		draw_polyline(sp, UI.ACCENT_2, 4.0 / zoom, true)
	for e in s.edges:
		var a: Vector2 = s.provinces[e["a"]].center
		var b: Vector2 = s.provinces[e["b"]].center
		draw_dashed_line(a, b, Color("e8dcc0", 0.45), (1.0 + float(e["capacity"]) * 0.22) / zoom, 9.0 / zoom)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# --- screen-space overlay (constant size, readable on phones)
	var f := _font()
	var ui_k := clampf(0.75 + zoom * 0.5, 0.85, 1.4)
	for e in s.edges:
		var mid := world_to_screen((s.provinces[e["a"]].center + s.provinces[e["b"]].center) * 0.5)
		draw_circle(mid, 10.0 * ui_k, Color(0, 0, 0, 0.6))
		_text(f, mid, str(int(float(e["capacity"]))), int(12 * ui_k), Color("e8dcc0"))
	for pid in s.province_order:
		var p: Province = s.provinces[pid]
		var c := world_to_screen(p.center)
		if p.city_id != "":
			_draw_city_icon(c + Vector2(0, -40) * ui_k, s.nations[p.owner].capital == pid, ui_k)
		_text(f, c + Vector2(0, -14) * ui_k, p.name, int(20 * ui_k), Color.WHITE, true)
		var sub: String = GameData.terrain_def(p.terrain)["name"]
		if p.fort > 0:
			sub += " · 要塞%d" % p.fort
		if map_mode == "resource":
			var parts := []
			for r in p.rural_output.keys():
				parts.append("%s%d" % [GameData.res_name(r), int(p.rural_output[r])])
			sub = " ".join(parts) if not parts.is_empty() else "无乡村产出"
		elif map_mode == "economy":
			var cc := s.city_of(pid)
			sub = "人口 %d" % int(p.pop + (cc.pop if cc else 0.0))
		elif map_mode == "military":
			var pw := 0.0
			for a in s.armies_in(pid):
				pw += MilitarySystem.army_power(s, a)
			sub = "兵力 %.0f" % pw
		_text(f, c + Vector2(0, 6) * ui_k, sub, int(14 * ui_k), Color(1, 1, 1, 0.85), true)
		if not p.siege.is_empty():
			var prog := float(p.siege["progress"]) / 100.0
			var sc := c + Vector2(44, -14) * ui_k
			draw_circle(sc, 14.0 * ui_k, Color(0, 0, 0, 0.6))
			draw_arc(sc, 14.0 * ui_k, -PI / 2, -PI / 2 + TAU * prog, 24, s.nations[p.siege["nation"]].color.lightened(0.35), 4.0)
			_text(f, sc, "围", int(13 * ui_k), Color.WHITE)
	_token_rects = {}
	for aid in s.sorted_army_ids():
		var a: Army = s.armies[aid]
		if not a.path.is_empty():
			var from := world_to_screen(s.provinces[a.province].center) + Vector2(0, 40) * ui_k
			for step in a.path:
				var to := world_to_screen(s.provinces[step].center) + Vector2(0, 40) * ui_k
				var col: Color = s.nations[a.nation].color.lightened(0.45)
				draw_line(from, to, col, 3.0)
				_arrow(from, to, col)
				from = to
	for pid in s.province_order:
		var i := 0
		for a in s.armies_in(pid):
			var pos := world_to_screen(s.provinces[pid].center) + Vector2(-36 + (i % 2) * 72, 40 + int(i / 2) * 34) * ui_k
			_draw_army(s, a, pos, f, ui_k)
			i += 1


func _draw_army(s: GameState, a: Army, pos: Vector2, f: Font, k: float) -> void:
	var col: Color = s.nations[a.nation].color
	var r := Rect2(pos - Vector2(32, 14) * k, Vector2(64, 28) * k)
	_token_rects[a.id] = r
	draw_rect(r.grow(2.0), Color(0, 0, 0, 0.65), true)
	draw_rect(r, col.darkened(0.05), true)
	if a.id == selected_army:
		draw_rect(r.grow(3.0), UI.ACCENT_2, false, 3.0)
	_text(f, r.get_center(), "%s %.1f" % [_army_glyph(a), a.total_strength()], int(15 * k), Color.WHITE)
	var mm := MilitarySystem.max_morale(s, a)
	var mr := Rect2(r.position + Vector2(0, r.size.y + 1), Vector2(r.size.x * clampf(a.morale / max(mm, 0.1), 0, 1), 4))
	draw_rect(mr, UI.GOOD if a.morale > 0.4 * mm else UI.BAD, true)
	if a.starving_weeks > 0 or float(a.supply_ratio.get("food", 1.0)) < 0.99 or float(a.supply_ratio.get("arms", 1.0)) < 0.99:
		draw_circle(r.position + Vector2(r.size.x, 0), 8.0 * k, UI.BAD)
		_text(f, r.position + Vector2(r.size.x, 0), "!", int(13 * k), Color.WHITE)


func _army_glyph(a: Army) -> String:
	if s_has(a, "artillery"):
		return "炮"
	if s_has(a, "infantry"):
		return "步"
	return "民"


func s_has(a: Army, u: String) -> bool:
	return float(a.units.get(u, 0.0)) > 0.05


func _arrow(a: Vector2, b: Vector2, col: Color) -> void:
	var d := (b - a).normalized()
	var tip := b - d * 34.0
	var n := Vector2(-d.y, d.x)
	draw_colored_polygon(PackedVector2Array([tip + d * 10.0, tip + n * 7.0, tip - n * 7.0]), col)


func _draw_hatch(poly: PackedVector2Array, col: Color) -> void:
	var r := Rect2(poly[0], Vector2.ZERO)
	for p in poly:
		r = r.expand(p)
	var step := 18.0
	var x := r.position.x - r.size.y
	while x < r.end.x:
		var a := Vector2(x, r.end.y)
		var b := Vector2(x + r.size.y, r.position.y)
		var segs := Geometry2D.intersect_polyline_with_polygon(PackedVector2Array([a, b]), poly)
		for sgm in segs:
			draw_polyline(sgm, Color(col, 0.75), 5.0)
		x += step


func _draw_city_icon(c: Vector2, capital: bool, k := 1.0) -> void:
	var base := c + Vector2(-16, 8) * k
	var pts := PackedVector2Array()
	for v in [Vector2(0, 0), Vector2(0, -12), Vector2(6, -18), Vector2(12, -12), Vector2(12, -6), Vector2(20, -14), Vector2(28, -6), Vector2(32, -6), Vector2(32, 0)]:
		pts.append(base + v * k)
	draw_colored_polygon(pts, Color("e8dcc0"))
	draw_polyline(pts + PackedVector2Array([pts[0]]), Color(0, 0, 0, 0.6), 1.5)
	if capital:
		var st := c + Vector2(22, -16) * k
		var star := PackedVector2Array()
		for i in range(10):
			var ang := -PI / 2 + i * PI / 5
			var rad := (7.0 if i % 2 == 0 else 3.0) * k
			star.append(st + Vector2(cos(ang), sin(ang)) * rad)
		draw_colored_polygon(star, UI.ACCENT_2)


func _text(f: Font, center: Vector2, txt: String, fs: int, col: Color, shadow := false) -> void:
	var w := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var pos := center + Vector2(-w * 0.5, fs * 0.35)
	if shadow:
		draw_string(f, pos + Vector2(1.5, 1.5), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0, 0, 0, 0.7))
	draw_string(f, pos, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
