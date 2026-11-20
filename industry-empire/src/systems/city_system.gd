class_name CitySystem
extends RefCounted
## City grid rules: terrain generation, placement validation, occupancy,
## road-network connectivity and site (terrain) production factors.

const DIRS := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]


static func generate_tiles(cdef: Dictionary) -> PackedByteArray:
	var w := int(cdef["size"][0])
	var h := int(cdef["size"][1])
	var t := PackedByteArray()
	t.resize(w * h)
	t.fill(GameData.tile_code["grass"])
	for f in cdef.get("features", []):
		var code: int = GameData.tile_code[f["tile"]]
		if f.has("rect"):
			var r: Array = f["rect"]
			for y in range(int(r[1]), int(r[1]) + int(r[3])):
				for x in range(int(r[0]), int(r[0]) + int(r[2])):
					if x >= 0 and y >= 0 and x < w and y < h:
						t[y * w + x] = code
		elif f.has("circle"):
			var c: Array = f["circle"]
			var cx := float(c[0])
			var cy := float(c[1])
			var rad := float(c[2])
			for y in range(h):
				for x in range(w):
					if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad:
						t[y * w + x] = code
	return t


static func rebuild_occupancy(city: City) -> void:
	city.occupancy = PackedInt32Array()
	city.occupancy.resize(city.width * city.height)
	city.occupancy.fill(0)
	for b: Building in city.buildings.values():
		_mark(city, b, b.id)


static func _mark(city: City, b: Building, value: int) -> void:
	var r := b.rect()
	for y in range(r.position.y, r.end.y):
		for x in range(r.position.x, r.end.x):
			city.occupancy[y * city.width + x] = value


static func normalize_rot(type: String, rot: int) -> int:
	var d: Dictionary = GameData.buildings[type]
	if not d.get("rotatable", false):
		return 0
	return rot % 2


## Validates terrain/overlap/bounds rules only (cost is checked by Commands).
static func can_place(city: City, type: String, x: int, y: int, rot: int) -> Dictionary:
	if not GameData.buildings.has(type):
		return {"ok": false, "reason": "未知建筑"}
	var d: Dictionary = GameData.buildings[type]
	rot = normalize_rot(type, rot)
	var sz := GameData.building_size(type, rot)
	var need_any: String = d.get("require_any_tile", "")
	var found_any := need_any == ""
	for yy in range(y, y + sz.y):
		for xx in range(x, x + sz.x):
			if not city.in_bounds(xx, yy):
				return {"ok": false, "reason": "超出城市边界"}
			if city.occupancy[yy * city.width + xx] != 0:
				return {"ok": false, "reason": "与现有建筑重叠"}
			var code := city.tile(xx, yy)
			var tdef: Dictionary = GameData.tiles[code]
			if not tdef["buildable"]:
				return {"ok": false, "reason": "无法在%s上施工" % tdef["name"]}
			if not d["allowed_tiles"].has(tdef["id"]):
				return {"ok": false, "reason": "%s不能建在%s上" % [d["name"], tdef["name"]]}
			if tdef["id"] == need_any:
				found_any = true
	if not found_any:
		return {"ok": false, "reason": "%s必须覆盖至少一格%s" % [d["name"], GameData.tiles[GameData.tile_code[need_any]]["name"]]}
	return {"ok": true, "reason": ""}


static func place(city: City, type: String, x: int, y: int, rot: int, build_left: int, turn: int, paid := {}) -> Building:
	var b := Building.new()
	b.id = city.next_building_id
	city.next_building_id += 1
	b.type = type
	b.x = x
	b.y = y
	b.rot = normalize_rot(type, rot)
	b.build_left = build_left
	b.placed_turn = turn
	b.paid = paid.duplicate()
	b.status = "施工中" if build_left > 0 else "待运转"
	city.buildings[b.id] = b
	_mark(city, b, b.id)
	city.dirty = true
	return b


static func remove(city: City, bid: int) -> void:
	var b: Building = city.buildings.get(bid)
	if b == null:
		return
	_mark(city, b, 0)
	city.buildings.erase(bid)
	city.dirty = true


static func is_road(city: City, x: int, y: int) -> bool:
	var b := city.building_at(x, y)
	return b != null and b.type == "road"


static func perimeter(rect: Rect2i) -> Array:
	var out := []
	for x in range(rect.position.x, rect.end.x):
		out.append(Vector2i(x, rect.position.y - 1))
		out.append(Vector2i(x, rect.end.y))
	for y in range(rect.position.y, rect.end.y):
		out.append(Vector2i(rect.position.x - 1, y))
		out.append(Vector2i(rect.end.x, y))
	return out


static func is_hub(b: Building) -> bool:
	return b.is_complete() and bool(b.def().get("hub", false))


## Recomputes which road tiles and buildings are linked to a warehouse.
static func refresh_connectivity(city: City) -> void:
	if not city.dirty:
		return
	city.road_connected = {}
	city.connected = {}
	var queue: Array = []
	for bid in city.sorted_ids():
		var b: Building = city.buildings[bid]
		if not is_hub(b):
			continue
		for t: Vector2i in perimeter(b.rect()):
			if city.in_bounds(t.x, t.y) and is_road(city, t.x, t.y) and not city.road_connected.has(t):
				city.road_connected[t] = true
				queue.append(t)
	var head := 0
	while head < queue.size():
		var cur: Vector2i = queue[head]
		head += 1
		for dv in DIRS:
			var n: Vector2i = cur + dv
			if city.in_bounds(n.x, n.y) and not city.road_connected.has(n) and is_road(city, n.x, n.y):
				city.road_connected[n] = true
				queue.append(n)
	for bid in city.sorted_ids():
		var b: Building = city.buildings[bid]
		if is_hub(b):
			city.connected[bid] = true
		elif b.type == "road":
			city.connected[bid] = city.road_connected.has(Vector2i(b.x, b.y))
		else:
			var ok := false
			for t: Vector2i in perimeter(b.rect()):
				if not city.in_bounds(t.x, t.y):
					continue
				if city.road_connected.has(t):
					ok = true
					break
				var nb := city.building_at(t.x, t.y)
				if nb != null and is_hub(nb):
					ok = true
					break
			city.connected[bid] = ok
	city.dirty = false


static func building_connected(city: City, bid: int) -> bool:
	refresh_connectivity(city)
	return bool(city.connected.get(bid, false))


static func site_factor(city: City, b: Building) -> float:
	var d: Dictionary = b.def()
	if not d.has("site"):
		return 1.0
	var site: Dictionary = d["site"]
	var code: int = GameData.tile_code[site["tile"]]
	var r := b.rect()
	if site["type"] == "footprint":
		var cnt := 0
		for y in range(r.position.y, r.end.y):
			for x in range(r.position.x, r.end.x):
				if city.tile(x, y) == code:
					cnt += 1
		return float(site["base"]) + float(site["per_ratio"]) * float(cnt) / float(r.size.x * r.size.y)
	# "nearby": free tiles of the given type within radius of the footprint
	var rad := int(site["radius"])
	var cnt2 := 0
	for y in range(r.position.y - rad, r.end.y + rad):
		for x in range(r.position.x - rad, r.end.x + rad):
			if not city.in_bounds(x, y) or r.has_point(Vector2i(x, y)):
				continue
			if city.tile(x, y) == code and city.occupancy[y * city.width + x] == 0:
				cnt2 += 1
	return min(float(site["max"]), float(site["base"]) + float(site["per_tile"]) * cnt2)


## Site factor a building of `type` would have at a position (for previews and AI).
static func preview_site_factor(city: City, type: String, x: int, y: int, rot: int) -> float:
	var b := Building.new()
	b.type = type
	b.x = x
	b.y = y
	b.rot = normalize_rot(type, rot)
	return site_factor(city, b)


static func housing_capacity(city: City) -> float:
	refresh_connectivity(city)
	var cap := 0.0
	for b: Building in city.buildings.values():
		if b.is_complete() and int(b.def().get("housing", 0)) > 0 and city.connected.get(b.id, false):
			cap += float(b.def()["housing"]) * (1.0 - b.damage * 0.5)
	return cap


static func warehouse_storage(city: City) -> float:
	var s := 0.0
	for b: Building in city.buildings.values():
		if is_hub(b):
			s += float(b.def().get("storage", 0.0))
	return s


static func has_complete(city: City, type: String) -> bool:
	for b: Building in city.buildings.values():
		if b.type == type and b.is_complete():
			return true
	return false


# ---------------------------------------------------------------- AI helpers

static func _road_ok_tile(city: City, x: int, y: int) -> bool:
	if not city.in_bounds(x, y):
		return false
	if city.occupancy[y * city.width + x] != 0:
		return false
	var tdef: Dictionary = GameData.tiles[city.tile(x, y)]
	return GameData.buildings["road"]["allowed_tiles"].has(tdef["id"])


## Shortest chain of new road tiles linking `rect` to the connected network.
## Returns [] if already adjacent, null if impossible within max_len.
static func road_path(city: City, rect: Rect2i, max_len: int) -> Variant:
	refresh_connectivity(city)
	var start: Array = []
	for t: Vector2i in perimeter(rect):
		if not city.in_bounds(t.x, t.y):
			continue
		if city.road_connected.has(t):
			return []
		var nb := city.building_at(t.x, t.y)
		if nb != null and is_hub(nb):
			return []
		if _road_ok_tile(city, t.x, t.y):
			start.append(t)
	var parent := {}
	var depth := {}
	var queue: Array = []
	for t: Vector2i in start:
		parent[t] = null
		depth[t] = 1
		queue.append(t)
	var head := 0
	while head < queue.size():
		var cur: Vector2i = queue[head]
		head += 1
		for dv in DIRS:
			var n: Vector2i = cur + dv
			if city.in_bounds(n.x, n.y) and city.road_connected.has(n):
				var path := []
				var c = cur
				while c != null:
					path.append(c)
					c = parent[c]
				return path
		if int(depth[cur]) >= max_len:
			continue
		for dv in DIRS:
			var n2: Vector2i = cur + dv
			if parent.has(n2) or rect.has_point(n2) or not _road_ok_tile(city, n2.x, n2.y):
				continue
			parent[n2] = cur
			depth[n2] = int(depth[cur]) + 1
			queue.append(n2)
	return null


## Finds the best valid site for `type` (deterministic scan). Score favours
## site factor and short road links. Returns {} if no site exists.
static func find_site(city: City, type: String, max_road := 6) -> Dictionary:
	refresh_connectivity(city)
	var d: Dictionary = GameData.buildings[type]
	var rots := [0, 1] if d.get("rotatable", false) else [0]
	var best := {}
	var best_score := -1e9
	for rot in rots:
		var sz := GameData.building_size(type, rot)
		for y in range(0, city.height - sz.y + 1):
			for x in range(0, city.width - sz.x + 1):
				if not can_place(city, type, x, y, rot)["ok"]:
					continue
				var rect := Rect2i(x, y, sz.x, sz.y)
				var near := false
				for t: Vector2i in perimeter(rect):
					if city.in_bounds(t.x, t.y) and city.road_connected.has(t):
						near = true
						break
				var site := preview_site_factor(city, type, x, y, rot)
				var score := site * 10.0
				if type == "residence" or d.get("category", "") == "industry":
					# keep the town compact around the warehouse
					score -= _dist_to_hub(city, rect) * 0.15
				if near:
					score += 3.0
				if score <= best_score:
					continue
				var path = [] if near else road_path(city, rect, max_road)
				if path == null:
					continue
				score -= 0.6 * path.size()
				if score > best_score:
					best_score = score
					best = {"x": x, "y": y, "rot": rot, "road": path, "score": score, "site": site}
	return best


static func _dist_to_hub(city: City, rect: Rect2i) -> float:
	var best := 99.0
	var c := Vector2(rect.position) + Vector2(rect.size) * 0.5
	for b: Building in city.buildings.values():
		if is_hub(b):
			var hc := Vector2(b.rect().position) + Vector2(b.rect().size) * 0.5
			best = min(best, c.distance_to(hc))
	return best
