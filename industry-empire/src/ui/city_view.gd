class_name CityView
extends MapCanvas
## City grid: terrain, buildings, roads, connectivity overlay and placement
## preview. Modes: "select", "place" (building ghost), "road" (two taps).

signal building_tapped(bid: int)
signal tile_tapped(cell: Vector2i)
signal preview_changed

const TILE := 32.0

var city_id := ""
var mode := "select"
var place_type := ""
var place_rot := 0
var ghost := Vector2i(-1, -1)
var road_start := Vector2i(-1, -1)
var road_end := Vector2i(-1, -1)
var selected_building := 0
var show_links := true


func _ready() -> void:
	super._ready()
	content_size = Vector2(24, 24) * TILE
	min_zoom = 0.4
	max_zoom = 4.0
	tapped.connect(_on_tap)


func city() -> City:
	if Session.state == null:
		return null
	return Session.state.cities.get(city_id)


func set_city(cid: String) -> void:
	city_id = cid
	var c := city()
	if c:
		content_size = Vector2(c.width, c.height) * TILE
	cancel_mode()
	_fitted = false
	if size.x > 10.0:
		fit()
		_fitted = true


func cancel_mode() -> void:
	mode = "select"
	place_type = ""
	ghost = Vector2i(-1, -1)
	road_start = Vector2i(-1, -1)
	road_end = Vector2i(-1, -1)
	queue_redraw()
	preview_changed.emit()


func start_place(type: String) -> void:
	if type == "road":
		mode = "road"
		place_type = "road"
		road_start = Vector2i(-1, -1)
		road_end = Vector2i(-1, -1)
	else:
		mode = "place"
		place_type = type
		ghost = Vector2i(-1, -1)
	selected_building = 0
	queue_redraw()
	preview_changed.emit()


func rotate_ghost() -> void:
	place_rot = (place_rot + 1) % 2
	queue_redraw()
	preview_changed.emit()


func _on_tap(w: Vector2) -> void:
	var c := city()
	if c == null:
		return
	var cell := Vector2i(int(floor(w.x / TILE)), int(floor(w.y / TILE)))
	if not c.in_bounds(cell.x, cell.y):
		return
	match mode:
		"place":
			var sz := GameData.building_size(place_type, CitySystem.normalize_rot(place_type, place_rot))
			ghost = Vector2i(clampi(cell.x - (sz.x - 1) / 2, 0, c.width - sz.x), clampi(cell.y - (sz.y - 1) / 2, 0, c.height - sz.y))
			preview_changed.emit()
		"road":
			if road_start.x < 0 or road_end.x >= 0:
				road_start = cell
				road_end = Vector2i(-1, -1)
			else:
				road_end = cell
			preview_changed.emit()
		_:
			var b := c.building_at(cell.x, cell.y)
			selected_building = b.id if b != null else 0
			building_tapped.emit(selected_building)
			tile_tapped.emit(cell)
	queue_redraw()


## Cells of an L-shaped road from start to end (horizontal first).
func road_cells() -> Array:
	var out := []
	if road_start.x < 0:
		return out
	var e := road_end if road_end.x >= 0 else road_start
	var x := road_start.x
	var y := road_start.y
	var dx := signi(e.x - x)
	out.append(Vector2i(x, y))
	while x != e.x:
		x += dx
		out.append(Vector2i(x, y))
	var dy := signi(e.y - y)
	while y != e.y:
		y += dy
		out.append(Vector2i(x, y))
	return out


func ghost_check() -> Dictionary:
	var c := city()
	if c == null or ghost.x < 0:
		return {"ok": false, "reason": "点击地块选择位置"}
	return CitySystem.can_place(c, place_type, ghost.x, ghost.y, place_rot)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), UI.BG)
	var c := city()
	if c == null:
		return
	draw_set_transform(offset, 0.0, Vector2(zoom, zoom))
	var f := get_theme_default_font()
	# terrain
	for y in range(c.height):
		for x in range(c.width):
			_draw_tile(c, x, y)
	# grid lines
	if zoom > 0.7:
		var gc := Color(0, 0, 0, 0.12)
		for x in range(c.width + 1):
			draw_line(Vector2(x * TILE, 0), Vector2(x * TILE, c.height * TILE), gc, 1.0 / zoom)
		for y in range(c.height + 1):
			draw_line(Vector2(0, y * TILE), Vector2(c.width * TILE, y * TILE), gc, 1.0 / zoom)
	CitySystem.refresh_connectivity(c)
	# roads
	for b in c.buildings.values():
		if b.type == "road":
			_draw_road(c, b)
	# buildings
	for bid in c.sorted_ids():
		var b: Building = c.buildings[bid]
		if b.type != "road":
			_draw_building(c, b, f)
	# placement preview
	if mode == "place" and ghost.x >= 0:
		var chk := ghost_check()
		var sz := GameData.building_size(place_type, CitySystem.normalize_rot(place_type, place_rot))
		var r := Rect2(Vector2(ghost) * TILE, Vector2(sz) * TILE)
		var col := UI.GOOD if chk["ok"] else UI.BAD
		draw_rect(r, Color(col, 0.35), true)
		draw_rect(r, col, false, 3.0 / zoom)
		_center_text(f, r.get_center(), GameData.buildings[place_type]["glyph"], 22, Color.WHITE)
		var site: Dictionary = GameData.buildings[place_type].get("site", {})
		if site.get("type", "") == "nearby":
			var rad := float(site["radius"]) * TILE
			draw_rect(r.grow(rad), Color(UI.GOOD, 0.6), false, 1.5 / zoom)
	if mode == "road":
		for cell in road_cells():
			var ok: bool = CitySystem.can_place(c, "road", cell.x, cell.y, 0)["ok"]
			var exists := c.building_at(cell.x, cell.y) != null and c.building_at(cell.x, cell.y).type == "road"
			var col2 := UI.GOOD if ok else (UI.MUTED if exists else UI.BAD)
			draw_rect(Rect2(Vector2(cell) * TILE, Vector2(TILE, TILE)).grow(-3), Color(col2, 0.6), true)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _hash(x: int, y: int) -> float:
	var h := (x * 73856093) ^ (y * 19349663)
	return float(abs(h) % 1000) / 1000.0


func _draw_tile(c: City, x: int, y: int) -> void:
	var code := c.tile(x, y)
	var tdef: Dictionary = GameData.tiles[code]
	var base := Color(tdef["color"])
	var hv := _hash(x, y)
	base = base.lightened((hv - 0.5) * 0.08)
	var r := Rect2(x * TILE, y * TILE, TILE, TILE)
	draw_rect(r, base, true)
	var o := r.position
	match tdef["id"]:
		"forest":
			for k in range(2):
				var p := o + Vector2(8 + k * 14 + hv * 4, 10 + k * 8)
				draw_colored_polygon(PackedVector2Array([p + Vector2(0, -9), p + Vector2(7, 6), p + Vector2(-7, 6)]), base.darkened(0.35))
		"rock":
			draw_circle(o + Vector2(10 + hv * 8, 12), 4.0, base.darkened(0.25))
			draw_circle(o + Vector2(22, 22 - hv * 6), 3.0, base.darkened(0.2))
		"coal":
			for k in range(3):
				draw_circle(o + Vector2(8 + k * 8, 10 + ((k + int(hv * 10)) % 3) * 6), 3.0, Color("1b1b20"))
		"iron":
			for k in range(3):
				draw_rect(Rect2(o + Vector2(6 + k * 8, 8 + ((k + int(hv * 10)) % 3) * 6), Vector2(5, 5)), Color("c46a42"), true)
		"fertile":
			for k in range(3):
				draw_line(o + Vector2(4, 8 + k * 9), o + Vector2(28, 8 + k * 9), base.darkened(0.18), 2.0)
		"water":
			draw_line(o + Vector2(6, 12 + hv * 4), o + Vector2(16, 10 + hv * 4), Color(1, 1, 1, 0.25), 1.5)
			draw_line(o + Vector2(14, 22), o + Vector2(26, 20), Color(1, 1, 1, 0.2), 1.5)
		"mountain":
			draw_colored_polygon(PackedVector2Array([o + Vector2(4, 28), o + Vector2(16, 4), o + Vector2(28, 28)]), base.darkened(0.25))
			draw_colored_polygon(PackedVector2Array([o + Vector2(12, 12), o + Vector2(16, 4), o + Vector2(20, 12)]), Color(1, 1, 1, 0.6))


func _draw_road(c: City, b: Building) -> void:
	var center := Vector2(b.x + 0.5, b.y + 0.5) * TILE
	var linked: bool = c.connected.get(b.id, false)
	var col := Color("cdb88e") if linked else Color("b08a6a")
	var w := TILE * 0.42
	draw_rect(Rect2(center - Vector2(w, w) * 0.5, Vector2(w, w)), col, true)
	for d in CitySystem.DIRS:
		var n: Vector2i = Vector2i(b.x, b.y) + d
		var nb := c.building_at(n.x, n.y)
		if nb == null:
			continue
		var to := center + Vector2(d) * TILE * 0.5
		draw_line(center, to, col, w)
	if show_links and not linked:
		draw_circle(center, 3.0, UI.BAD)


func _draw_building(c: City, b: Building, f: Font) -> void:
	var d: Dictionary = b.def()
	var r := Rect2(Vector2(b.x, b.y) * TILE, Vector2(b.size()) * TILE).grow(-2.0)
	var col := Color(d["color"])
	var linked: bool = c.connected.get(b.id, false)
	# shadow + body + low-poly roof facets
	draw_rect(Rect2(r.position + Vector2(3, 3), r.size), Color(0, 0, 0, 0.35), true)
	draw_rect(r, col, true)
	var roof := PackedVector2Array([r.position, r.position + Vector2(r.size.x, 0), r.position + Vector2(r.size.x * 0.5, r.size.y * 0.45)])
	draw_colored_polygon(roof, col.lightened(0.18))
	var roof2 := PackedVector2Array([r.position + Vector2(0, r.size.y), r.end, r.position + Vector2(r.size.x * 0.5, r.size.y * 0.55)])
	draw_colored_polygon(roof2, col.darkened(0.15))
	if not b.is_complete():
		var step := 8.0
		var x0 := r.position.x
		while x0 < r.end.x + r.size.y:
			var a := Vector2(x0, r.position.y)
			var e := Vector2(x0 - r.size.y, r.end.y)
			var seg := Geometry2D.intersect_polyline_with_polygon(PackedVector2Array([a, e]), PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]))
			for sg in seg:
				draw_polyline(sg, Color(0, 0, 0, 0.35), 2.0)
			x0 += step
	var border := col.darkened(0.5)
	var bw := 1.5
	if d.get("needs_connection", false) and not linked and show_links:
		border = UI.BAD
		bw = 3.0
	if b.id == selected_building:
		border = UI.ACCENT_2
		bw = 3.5
	draw_rect(r, border, false, bw / max(zoom, 0.5))
	_center_text(f, r.get_center(), d["glyph"], 20 if r.size.x > 40 else 16, Color.WHITE)
	if not b.is_complete():
		_center_text(f, r.get_center() + Vector2(0, 16), "%d周" % b.build_left, 11, Color.WHITE)
	elif d["stage"] >= 0:
		# efficiency bar
		var eff := clampf(b.activity, 0.0, 1.0)
		var br := Rect2(r.position + Vector2(3, r.size.y - 6), Vector2((r.size.x - 6) * eff, 3))
		draw_rect(br, UI.GOOD if eff > 0.75 else (UI.WARN if eff > 0.3 else UI.BAD), true)
	if b.damage > 0.05:
		draw_line(r.position + Vector2(4, 6), r.position + Vector2(14, 16), UI.BAD, 2.0)
		draw_line(r.position + Vector2(14, 16), r.position + Vector2(10, 22), UI.BAD, 2.0)


func _center_text(f: Font, center: Vector2, txt: String, fs: int, col: Color) -> void:
	var w := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var pos := center + Vector2(-w * 0.5, fs * 0.35)
	draw_string(f, pos + Vector2(1, 1), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0, 0, 0, 0.6))
	draw_string(f, pos, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
