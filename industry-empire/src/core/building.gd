class_name Building
extends RefCounted
## A placed building inside a city grid.

var id := 0
var type := ""
var x := 0
var y := 0
var rot := 0                 # 0 = as defined, 1 = rotated 90°
var build_left := 0          # weeks of construction remaining (0 = complete)
var damage := 0.0            # 0..1 war damage
var enabled := true
var placed_turn := 0
var paid := {}               # what was paid (for undo/refund)
# derived each week (also saved so the UI shows the same thing after loading)
var workers := 0
var activity := 0.0
var status := ""
var last_in := {}
var last_out := {}


func def() -> Dictionary:
	return GameData.buildings[type]


func size() -> Vector2i:
	return GameData.building_size(type, rot)


func rect() -> Rect2i:
	return Rect2i(Vector2i(x, y), size())


func is_complete() -> bool:
	return build_left <= 0


func to_dict() -> Dictionary:
	return {
		"id": id, "type": type, "x": x, "y": y, "rot": rot, "build_left": build_left,
		"damage": damage, "enabled": enabled, "placed_turn": placed_turn, "paid": paid.duplicate(),
		"workers": workers, "activity": activity, "status": status,
		"last_in": last_in.duplicate(), "last_out": last_out.duplicate(),
	}


static func from_dict(d: Dictionary) -> Building:
	var b := Building.new()
	b.id = int(d["id"])
	b.type = d["type"]
	b.x = int(d["x"])
	b.y = int(d["y"])
	b.rot = int(d["rot"])
	b.build_left = int(d["build_left"])
	b.damage = float(d["damage"])
	b.enabled = bool(d["enabled"])
	b.placed_turn = int(d["placed_turn"])
	b.paid = Ser.float_dict(d["paid"])
	b.workers = int(d["workers"])
	b.activity = float(d["activity"])
	b.status = d["status"]
	b.last_in = Ser.float_dict(d["last_in"])
	b.last_out = Ser.float_dict(d["last_out"])
	return b
