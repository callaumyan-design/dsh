class_name TechnologySystem
extends RefCounted
## Research progress and tech modifiers. Every tech effect changes a real
## simulation parameter queried through mod().


static func _effects(state: GameState, nid: String) -> Array:
	if state.tech_cache.has(nid):
		return state.tech_cache[nid]
	var out := []
	var n: Nation = state.nations.get(nid)
	if n != null:
		for tid in n.techs:
			for e in GameData.techs[tid]["effects"]:
				out.append(e)
	state.tech_cache[nid] = out
	return out


## Sum of effect values of `type` matching `key` (building/unit/category/resource).
static func mod(state: GameState, nid: String, type: String, key := "", key2 := "") -> float:
	var total := 0.0
	for e in _effects(state, nid):
		if e["type"] != type:
			continue
		match type:
			"output_mult":
				if e["building"] == key:
					total += float(e["value"])
			"input_mult":
				if e["building"] == key and e["resource"] == key2:
					total += float(e["value"])
			"throughput_mult":
				if e["category"] == key:
					total += float(e["value"])
			"unit_attack_mult", "unit_defense_mult", "siege_mult":
				if e["unit"] == "*" or e["unit"] == key:
					total += float(e["value"])
			_:
				total += float(e["value"])
	return total


static func can_research(state: GameState, nid: String, tid: String) -> bool:
	var n: Nation = state.nations[nid]
	if not GameData.techs.has(tid) or n.techs.has(tid):
		return false
	for req in GameData.techs[tid]["requires"]:
		if not n.techs.has(req):
			return false
	return true


static func available(state: GameState, nid: String) -> Array:
	var out := []
	for tid in GameData.tech_order:
		if can_research(state, nid, tid):
			out.append(tid)
	return out


static func funding_cost(n: Nation) -> float:
	var levels: Array = GameData.bal("research.funding_levels", [0])
	return float(levels[clampi(n.research_funding, 0, levels.size() - 1)])


## Research points generated per week (before funding is paid).
static func weekly_points(state: GameState, nid: String, include_funding := true) -> float:
	var n: Nation = state.nations[nid]
	var rp := GameData.balf("research.base", 1.0)
	for c: City in state.cities.values():
		var p: Province = state.provinces[c.province_id]
		if p.owner == nid and p.controller == nid:
			rp += c.pop * GameData.balf("research.per_city_pop", 0.01)
	if include_funding:
		rp += funding_cost(n) / GameData.balf("research.money_per_point", 5.0)
	return rp


static func run(state: GameState) -> void:
	for nid in state.active_nations():
		var n: Nation = state.nations[nid]
		var cost := funding_cost(n)
		var funded := cost
		if cost > 0.0 and n.treasury < cost:
			funded = 0.0  # cannot fund research while broke
		if funded > 0.0:
			EconomySystem.spend(n, funded, "research")
		var rp := weekly_points(state, nid, false) + funded / GameData.balf("research.money_per_point", 5.0)
		n.research_bank += rp
		_apply_bank(state, n)


static func _apply_bank(state: GameState, n: Nation) -> void:
	var guard := 0
	while n.research_bank > 0.0001 and guard < 8:
		guard += 1
		if n.research_target == "" or not can_research(state, n.id, n.research_target):
			n.research_target = ""
			return
		var tid := n.research_target
		var cost: float = GameData.techs[tid]["cost"]
		var have := float(n.research_progress.get(tid, 0.0))
		var add: float = min(n.research_bank, cost - have)
		have += add
		n.research_bank -= add
		n.research_progress[tid] = have
		if have >= cost - 0.0001:
			complete(state, n, tid)
			n.research_target = ""


static func complete(state: GameState, n: Nation, tid: String) -> void:
	if n.techs.has(tid):
		return
	n.techs.append(tid)
	n.research_progress[tid] = GameData.techs[tid]["cost"]
	state.tech_cache.erase(n.id)
	state.log_event("tech", "%s 完成研究：%s" % [n.short_name, GameData.techs[tid]["name"]], [n.id])
	if n.is_ai:
		return
	# keep player flow going: nothing auto-selected, points are banked.


static func progress_ratio(n: Nation, tid: String) -> float:
	return clampf(float(n.research_progress.get(tid, 0.0)) / float(GameData.techs[tid]["cost"]), 0.0, 1.0)
