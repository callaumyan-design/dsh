class_name Province
extends RefCounted
## A strategic map province. Holds the province stockpile shared by its city.

var id := ""
var name := ""
var owner := ""
var controller := ""
var terrain := "plains"
var pop := 0.0               # rural population
var base_pop := 0.0
var development := 1
var fort := 0
var rural_output := {}       # res -> base weekly amount
var deposits: Array = []
var city_id := ""
var stock := {}              # res -> float (shared by city in this province)
var center := Vector2.ZERO
var polygon := PackedVector2Array()
var damage := 0.0            # war damage 0..1
var stability := 70.0
var siege := {}              # {"nation": id, "progress": float}
var claim := {}              # {"nation": id, "weeks_left": int}
var last_output := {}
var occupied_since := -1


func is_occupied() -> bool:
	return controller != owner


func is_coastal() -> bool:
	return bool(GameData.terrain_def(terrain).get("coastal", false))


func get_stock(res: String) -> float:
	return float(stock.get(res, 0.0))


func to_dict() -> Dictionary:
	var poly := []
	for p in polygon:
		poly.append([p.x, p.y])
	return {
		"id": id, "name": name, "owner": owner, "controller": controller, "terrain": terrain,
		"pop": pop, "base_pop": base_pop, "development": development, "fort": fort,
		"rural_output": rural_output.duplicate(), "deposits": deposits.duplicate(), "city_id": city_id,
		"stock": stock.duplicate(), "center": [center.x, center.y], "polygon": poly,
		"damage": damage, "stability": stability, "siege": siege.duplicate(), "claim": claim.duplicate(),
		"last_output": last_output.duplicate(), "occupied_since": occupied_since,
	}


static func from_dict(d: Dictionary) -> Province:
	var p := Province.new()
	p.id = d["id"]
	p.name = d["name"]
	p.owner = d["owner"]
	p.controller = d["controller"]
	p.terrain = d["terrain"]
	p.pop = float(d["pop"])
	p.base_pop = float(d["base_pop"])
	p.development = int(d["development"])
	p.fort = int(d["fort"])
	p.rural_output = Ser.float_dict(d["rural_output"])
	p.deposits = Array(d["deposits"])
	p.city_id = d["city_id"]
	p.stock = Ser.float_dict(d["stock"])
	p.center = Ser.vec2(d["center"])
	var poly := PackedVector2Array()
	for pt in d["polygon"]:
		poly.append(Ser.vec2(pt))
	p.polygon = poly
	p.damage = float(d["damage"])
	p.stability = float(d["stability"])
	p.siege = {}
	if d["siege"].size() > 0:
		p.siege = {"nation": d["siege"]["nation"], "progress": float(d["siege"]["progress"])}
	p.claim = {}
	if d["claim"].size() > 0:
		p.claim = {"nation": d["claim"]["nation"], "weeks_left": int(d["claim"]["weeks_left"])}
	p.last_output = Ser.float_dict(d["last_output"])
	p.occupied_since = int(d["occupied_since"])
	return p
