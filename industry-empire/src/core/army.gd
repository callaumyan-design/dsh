class_name Army
extends RefCounted
## A stack of regiments on the strategic map. Unit counts are float strengths
## (1.0 = one full regiment); casualties reduce strength.

var id := 0
var nation := ""
var name := ""
var province := ""
var units := {}              # unit type -> strength
var morale := 1.0
var supply := {"food": 0.0, "arms": 0.0}        # carried supply buffer
var supply_ratio := {"food": 1.0, "arms": 1.0}  # fraction of last week's needs met
var path: Array = []         # remaining province ids to traverse (next first)
var move_progress := 0.0
var starving_weeks := 0
var arrived_turn := -1
var in_battle := false
var last_battle_turn := -100


func total_strength() -> float:
	var s := 0.0
	for k in units.keys():
		s += float(units[k])
	return s


func is_empty() -> bool:
	return total_strength() < 0.05


func men() -> int:
	var m := 0.0
	for k in units.keys():
		m += float(units[k]) * float(GameData.units[k]["manpower"])
	return int(round(m))


func weekly_need() -> Dictionary:
	var need := {"food": 0.0, "arms": 0.0}
	for k in units.keys():
		var sup: Dictionary = GameData.units[k]["supply"]
		need["food"] += float(units[k]) * float(sup.get("food", 0.0))
		need["arms"] += float(units[k]) * float(sup.get("arms", 0.0))
	return need


func speed() -> float:
	var s := 99.0
	for k in units.keys():
		if float(units[k]) > 0.01:
			s = min(s, float(GameData.units[k]["speed"]))
	return 1.0 if s > 90.0 else s


func composition_text() -> String:
	var parts := []
	for uid in GameData.unit_order:
		if units.has(uid) and float(units[uid]) > 0.01:
			parts.append("%s%.1f" % [GameData.units[uid]["name"], float(units[uid])])
	return " ".join(parts)


func to_dict() -> Dictionary:
	return {
		"id": id, "nation": nation, "name": name, "province": province, "units": units.duplicate(),
		"morale": morale, "supply": supply.duplicate(), "supply_ratio": supply_ratio.duplicate(),
		"path": path.duplicate(), "move_progress": move_progress, "starving_weeks": starving_weeks,
		"arrived_turn": arrived_turn, "in_battle": in_battle, "last_battle_turn": last_battle_turn,
	}


static func from_dict(d: Dictionary) -> Army:
	var a := Army.new()
	a.id = int(d["id"])
	a.nation = d["nation"]
	a.name = d["name"]
	a.province = d["province"]
	a.units = Ser.float_dict(d["units"])
	a.morale = float(d["morale"])
	a.supply = Ser.float_dict(d["supply"])
	a.supply_ratio = Ser.float_dict(d["supply_ratio"])
	a.path = Array(d["path"])
	a.move_progress = float(d["move_progress"])
	a.starving_weeks = int(d["starving_weeks"])
	a.arrived_turn = int(d["arrived_turn"])
	a.in_battle = bool(d["in_battle"])
	a.last_battle_turn = int(d["last_battle_turn"])
	return a
