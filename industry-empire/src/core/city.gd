class_name City
extends RefCounted
## A buildable city: a tile grid with buildings. Its goods live in the
## stockpile of the province it belongs to (single source of truth).

var id := ""
var name := ""
var province_id := ""
var width := 24
var height := 24
var tiles := PackedByteArray()
var buildings := {}          # int id -> Building
var next_building_id := 1
var pop := 0.0
var satisfaction := 60.0
var undo_stack: Array = []   # [{"turn": int, "building_id": int}]
var stats := {}              # last week summary for UI / AI
# derived (rebuilt, never saved)
var occupancy := PackedInt32Array()
var road_connected := {}     # Vector2i -> true for road tiles linked to a warehouse
var connected := {}          # building id -> bool
var dirty := true


func tile(x: int, y: int) -> int:
	return tiles[y * width + x]


func in_bounds(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < width and y < height


func building_at(x: int, y: int) -> Building:
	if not in_bounds(x, y):
		return null
	var bid := occupancy[y * width + x]
	if bid <= 0:
		return null
	return buildings.get(bid)


func sorted_ids() -> Array:
	var ids := buildings.keys()
	ids.sort()
	return ids


func count_type(type: String, complete_only := false) -> int:
	var c := 0
	for b: Building in buildings.values():
		if b.type == type and (not complete_only or b.is_complete()):
			c += 1
	return c


func to_dict() -> Dictionary:
	var bl := []
	for bid in sorted_ids():
		bl.append(buildings[bid].to_dict())
	return {
		"id": id, "name": name, "province_id": province_id, "width": width, "height": height,
		"tiles": Marshalls.raw_to_base64(tiles), "buildings": bl, "next_building_id": next_building_id,
		"pop": pop, "satisfaction": satisfaction, "undo_stack": undo_stack.duplicate(true),
		"stats": stats.duplicate(true),
	}


static func from_dict(d: Dictionary) -> City:
	var c := City.new()
	c.id = d["id"]
	c.name = d["name"]
	c.province_id = d["province_id"]
	c.width = int(d["width"])
	c.height = int(d["height"])
	c.tiles = Marshalls.base64_to_raw(d["tiles"])
	for bd in d["buildings"]:
		var b := Building.from_dict(bd)
		c.buildings[b.id] = b
	c.next_building_id = int(d["next_building_id"])
	c.pop = float(d["pop"])
	c.satisfaction = float(d["satisfaction"])
	c.undo_stack = []
	for u in d["undo_stack"]:
		c.undo_stack.append({"turn": int(u["turn"]), "building_id": int(u["building_id"])})
	c.stats = d["stats"]
	c.dirty = true
	return c
