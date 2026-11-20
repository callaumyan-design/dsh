class_name GameData
extends RefCounted
## Static, read-only game configuration loaded from res://data/*.json.
## All balance numbers live in data files; systems query them through here.

const DATA_DIR := "res://data/"
const RESOURCE_IDS := ["wood", "stone", "grain", "food", "coal", "iron", "steel", "arms"]

static var loaded := false
static var resources: Array = []
static var resource_by_id: Dictionary = {}
static var buildings: Dictionary = {}
static var building_order: Array = []
static var units: Dictionary = {}
static var unit_order: Array = []
static var techs: Dictionary = {}
static var tech_order: Array = []
static var terrain: Dictionary = {}
static var tiles: Array = []
static var tile_code: Dictionary = {}
static var balance: Dictionary = {}
static var ai: Dictionary = {}
static var scenarios: Dictionary = {}
static var errors: PackedStringArray = []


static func ensure_loaded() -> void:
	if not loaded:
		load_all()


static func load_all() -> bool:
	errors = PackedStringArray()
	var res_json = _read_json("resources.json")
	var b_json = _read_json("buildings.json")
	var u_json = _read_json("units.json")
	var t_json = _read_json("techs.json")
	var terr_json = _read_json("terrain.json")
	balance = _read_json("balance.json")
	ai = _read_json("ai.json")
	var scen = _read_json("scenario_mvp.json")
	if errors.size() > 0:
		push_error("GameData load errors: %s" % ", ".join(errors))
		return false
	resources = res_json["resources"]
	resource_by_id = {}
	for r in resources:
		resource_by_id[r["id"]] = r
	buildings = {}
	building_order = []
	for b in b_json["buildings"]:
		_normalize_building(b)
		buildings[b["id"]] = b
		building_order.append(b["id"])
	units = {}
	unit_order = []
	for u in u_json["units"]:
		units[u["id"]] = u
		unit_order.append(u["id"])
	techs = {}
	tech_order = []
	for t in t_json["techs"]:
		t["cost"] = float(t["cost"])
		techs[t["id"]] = t
		tech_order.append(t["id"])
	terrain = terr_json["province_terrain"]
	tiles = []
	tile_code = {}
	var tl: Array = terr_json["city_tiles"]
	tiles.resize(tl.size())
	for t in tl:
		t["code"] = int(t["code"])
		tiles[t["code"]] = t
		tile_code[t["id"]] = t["code"]
	scenarios = {}
	scenarios[scen["id"]] = scen
	loaded = true
	var verrs := validate()
	if verrs.size() > 0:
		for e in verrs:
			push_error("Data validation: " + e)
		errors.append_array(verrs)
	return errors.size() == 0


static func _normalize_building(b: Dictionary) -> void:
	b["size"] = [int(b["size"][0]), int(b["size"][1])]
	b["build_weeks"] = int(b.get("build_weeks", 0))
	b["workers"] = int(b.get("workers", 0))
	b["upkeep"] = float(b.get("upkeep", 0.0))
	b["stage"] = int(b.get("stage", -1))
	b["priority"] = int(b.get("priority", 50))
	b["housing"] = int(b.get("housing", 0))
	b["storage"] = float(b.get("storage", 0))
	for k in ["inputs", "outputs", "cost"]:
		if not b.has(k):
			b[k] = {}
		for r in b[k].keys():
			b[k][r] = float(b[k][r])
	if not b.has("allowed_tiles"):
		b["allowed_tiles"] = ["grass"]


static func _read_json(file: String) -> Variant:
	var path := DATA_DIR + file
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		errors.append("cannot open " + path)
		return {}
	var txt := f.get_as_text()
	var json := JSON.new()
	var err := json.parse(txt)
	if err != OK:
		errors.append("%s: JSON error line %d: %s" % [path, json.get_error_line(), json.get_error_message()])
		return {}
	return json.data


## Data validation rules. Returns a list of human readable problems (empty = valid).
static func validate() -> PackedStringArray:
	var out := PackedStringArray()
	for rid in RESOURCE_IDS:
		if not resource_by_id.has(rid):
			out.append("missing resource " + rid)
	for bid in building_order:
		var b: Dictionary = buildings[bid]
		if b["size"][0] < 1 or b["size"][1] < 1:
			out.append("%s: invalid size" % bid)
		for k in ["inputs", "outputs", "cost"]:
			for r in b[k].keys():
				if r != "money" and not resource_by_id.has(r):
					out.append("%s.%s: unknown resource %s" % [bid, k, r])
				if float(b[k][r]) < 0.0:
					out.append("%s.%s: negative amount for %s" % [bid, k, r])
		if b["inputs"].size() > 0 and b["outputs"].size() == 0:
			out.append("%s: consumes inputs but produces nothing" % bid)
		if b["outputs"].size() > 0 and b["stage"] < 0:
			out.append("%s: producer without stage" % bid)
		for t in b["allowed_tiles"]:
			if not tile_code.has(t):
				out.append("%s: unknown tile %s" % [bid, t])
			elif not tiles[tile_code[t]]["buildable"]:
				out.append("%s: allows unbuildable tile %s" % [bid, t])
		# A producer must not output something it also consumes (no free loops).
		for r in b["outputs"].keys():
			if b["inputs"].has(r):
				out.append("%s: produces and consumes %s" % [bid, r])
	for uid in unit_order:
		var u: Dictionary = units[uid]
		for k in ["attack", "defense", "max_morale", "speed", "manpower"]:
			if float(u.get(k, 0)) <= 0.0:
				out.append("%s: %s must be > 0" % [uid, k])
		if u["requires_building"] != "" and not buildings.has(u["requires_building"]):
			out.append("%s: requires unknown building" % uid)
	for tid in tech_order:
		for req in techs[tid]["requires"]:
			if not techs.has(req):
				out.append("%s requires unknown %s" % [tid, req])
	# Cycle check on tech tree (techs must be listed after prerequisites).
	var seen := {}
	for tid in tech_order:
		for req in techs[tid]["requires"]:
			if not seen.has(req):
				out.append("tech %s listed before prerequisite %s" % [tid, req])
		seen[tid] = true
	for sid in scenarios.keys():
		out.append_array(validate_scenario(scenarios[sid]))
	return out


static func validate_scenario(s: Dictionary) -> PackedStringArray:
	var out := PackedStringArray()
	var nation_ids := {}
	for n in s["nations"]:
		nation_ids[n["id"]] = true
	var prov_ids := {}
	for p in s["provinces"]:
		prov_ids[p["id"]] = true
		if not nation_ids.has(p["owner"]):
			out.append("province %s: unknown owner" % p["id"])
		if not terrain.has(p["terrain"]):
			out.append("province %s: unknown terrain" % p["id"])
		for r in p.get("rural_output", {}).keys():
			if not resource_by_id.has(r):
				out.append("province %s: unknown rural resource %s" % [p["id"], r])
	var pairs := {}
	for e in s["edges"]:
		if not prov_ids.has(e["a"]) or not prov_ids.has(e["b"]):
			out.append("edge %s-%s: unknown province" % [e["a"], e["b"]])
		if e["a"] == e["b"]:
			out.append("edge self loop " + e["a"])
		var key: String = e["a"] + "|" + e["b"] if e["a"] < e["b"] else e["b"] + "|" + e["a"]
		if pairs.has(key):
			out.append("duplicate edge " + key)
		pairs[key] = true
		if float(e["capacity"]) <= 0.0:
			out.append("edge %s non-positive capacity" % key)
	for n in s["nations"]:
		if not n.get("native", false) and not prov_ids.has(n["capital"]):
			out.append("nation %s: invalid capital" % n["id"])
	for a in s["armies"]:
		if not nation_ids.has(a["nation"]) or not prov_ids.has(a["province"]):
			out.append("army %s invalid" % a.get("name", "?"))
		for u in a["units"].keys():
			if not units.has(u):
				out.append("army %s unknown unit %s" % [a.get("name", "?"), u])
	return out


# ---------------------------------------------------------------- helpers

static func bal(path: String, default_value = null):
	var cur = balance
	for part in path.split("."):
		if typeof(cur) != TYPE_DICTIONARY or not cur.has(part):
			return default_value
		cur = cur[part]
	return cur


static func balf(path: String, default_value := 0.0) -> float:
	return float(bal(path, default_value))


static func res_name(rid: String) -> String:
	if rid == "money":
		return "金钱"
	return resource_by_id[rid]["name"] if resource_by_id.has(rid) else rid


static func res_price(rid: String) -> float:
	return float(resource_by_id[rid]["base_price"]) if resource_by_id.has(rid) else 1.0


static func tile_id(code: int) -> String:
	return tiles[code]["id"]


static func terrain_def(tid: String) -> Dictionary:
	return terrain.get(tid, terrain["plains"])


static func scenario(sid: String = "mvp_two_crowns") -> Dictionary:
	ensure_loaded()
	return scenarios[sid]


static func building_size(type: String, rot: int) -> Vector2i:
	var s: Array = buildings[type]["size"]
	if rot % 2 == 1:
		return Vector2i(s[1], s[0])
	return Vector2i(s[0], s[1])


static func cost_text(cost: Dictionary) -> String:
	var parts := []
	if cost.has("money"):
		parts.append("¥%d" % int(round(cost["money"])))
	for r in RESOURCE_IDS:
		if cost.has(r) and cost[r] > 0:
			parts.append("%s%d" % [res_name(r), int(round(cost[r]))])
	return " ".join(parts)
