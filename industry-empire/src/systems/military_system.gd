class_name MilitarySystem
extends RefCounted
## Recruitment, manpower, supply consumption, attrition, movement, sieges
## and occupation.

const EPS := 0.0001


# ---------------------------------------------------------------- helpers

static func max_morale(state: GameState, a: Army) -> float:
	var tot := 0.0
	var w := 0.0
	for u in a.units.keys():
		var s := float(a.units[u])
		tot += s * float(GameData.units[u]["max_morale"])
		w += s
	var base := tot / w if w > EPS else 1.0
	if not state.nations[a.nation].is_native:
		base += TechnologySystem.mod(state, a.nation, "morale_bonus")
	return base


static func add_supply(state: GameState, a: Army, res: String, amount: float) -> void:
	if amount <= EPS:
		return
	a.supply[res] = float(a.supply.get(res, 0.0)) + amount
	state.ledger_add("army_supply_in", res, amount)


static func men_in_service(state: GameState, nid: String) -> int:
	var m := 0
	for a: Army in state.armies_of(nid):
		m += a.men()
	return m


static func manpower_available(state: GameState, nid: String) -> int:
	var pool := EconomySystem.total_population(state, nid) * GameData.balf("population.draft_ratio", 0.15)
	return max(0, int(floor(pool)) - men_in_service(state, nid))


## Removes recruits from the population of all owned provinces, proportional
## to their population (cities lose labour, the countryside loses output).
static func draw_manpower(state: GameState, nid: String, men: float) -> void:
	var total := EconomySystem.total_population(state, nid)
	if total <= 0.0:
		return
	for pid in state.provinces_owned(nid):
		var p: Province = state.provinces[pid]
		p.pop = max(GameData.balf("population.min_pop", 20), p.pop - men * p.pop / total)
		var c := state.city_of(pid)
		if c != null:
			c.pop = max(GameData.balf("population.min_pop", 20), c.pop - men * c.pop / total)


static func unit_power(state: GameState, nid: String, uid: String) -> float:
	var u: Dictionary = GameData.units[uid]
	var atk := float(u["attack"]) * (1.0 + TechnologySystem.mod(state, nid, "unit_attack_mult", uid))
	var dfn := float(u["defense"]) * (1.0 + TechnologySystem.mod(state, nid, "unit_defense_mult", uid))
	return (atk + dfn) * 0.5


static func army_power(state: GameState, a: Army) -> float:
	var p := 0.0
	for u in a.units.keys():
		p += float(a.units[u]) * unit_power(state, a.nation, u)
	var mm := max_morale(state, a)
	return p * (0.4 + 0.6 * clampf(a.morale / max(mm, 0.1), 0.0, 1.0))


static func nation_power(state: GameState, nid: String) -> float:
	var t := 0.0
	for a: Army in state.armies_of(nid):
		t += army_power(state, a)
	return t


static func power_in(state: GameState, pid: String, nid: String) -> float:
	var t := 0.0
	for a: Army in state.armies_in(pid, nid):
		t += army_power(state, a)
	return t


static func recruit_province_ok(state: GameState, nid: String, pid: String, uid: String) -> Dictionary:
	var p: Province = state.provinces.get(pid)
	if p == null:
		return {"ok": false, "reason": "省份不存在"}
	if p.owner != nid or p.controller != nid:
		return {"ok": false, "reason": "只能在本国控制的省份征兵"}
	if LogisticsSystem.blockaded(state, nid, pid):
		return {"ok": false, "reason": "敌军在境，无法征兵"}
	var req: String = GameData.units[uid]["requires_building"]
	if req != "":
		var c := state.city_of(pid)
		if c == null or not CitySystem.has_complete(c, req):
			return {"ok": false, "reason": "需要本省城市拥有已建成的%s" % GameData.buildings[req]["name"]}
	return {"ok": true, "reason": ""}


static func recruit_cost(uid: String, count: int) -> Dictionary:
	var cost := {}
	var base: Dictionary = GameData.units[uid]["cost"]
	for k in base.keys():
		cost[k] = float(base[k]) * count
	return cost


## Resources for recruits are taken from the recruiting province, then the capital.
static func recruit_sources(state: GameState, nid: String, pid: String) -> Array:
	var out := [state.provinces[pid]]
	var cap: String = state.nations[nid].capital
	if cap != pid and state.provinces.has(cap) and state.provinces[cap].controller == nid:
		out.append(state.provinces[cap])
	return out


static func create_army(state: GameState, nid: String, pid: String, name: String) -> Army:
	var a := Army.new()
	a.id = state.next_army_id
	state.next_army_id += 1
	a.nation = nid
	a.province = pid
	a.name = name
	a.morale = 0.0
	state.armies[a.id] = a
	return a


static func army_name(state: GameState, nid: String) -> String:
	var idx := state.armies_of(nid).size() + 1
	var nums := ["第一", "第二", "第三", "第四", "第五", "第六", "第七", "第八", "第九", "第十"]
	return "%s军团" % (nums[idx - 1] if idx <= nums.size() else "第%d" % idx)


static func remove_army(state: GameState, a: Army) -> void:
	# carried supply is lost with the army
	for r in a.supply.keys():
		if float(a.supply[r]) > 0.0:
			state.ledger_add("army_lost", r, -float(a.supply[r]))
	a.supply = {"food": 0.0, "arms": 0.0}
	state.armies.erase(a.id)


static func apply_losses(a: Army, losses: float) -> float:
	## Distribute regiment losses by casualty weight. Returns men lost.
	var wsum := 0.0
	for u in a.units.keys():
		wsum += float(a.units[u]) * float(GameData.units[u]["casualty_weight"])
	if wsum <= EPS:
		return 0.0
	var men := 0.0
	for u in a.units.keys():
		var share := float(a.units[u]) * float(GameData.units[u]["casualty_weight"]) / wsum
		var l: float = min(float(a.units[u]), losses * share)
		a.units[u] = float(a.units[u]) - l
		men += l * float(GameData.units[u]["manpower"])
	return men


# ---------------------------------------------------------------- weekly phases

## Supply consumption, starvation attrition, morale recovery and reinforcement.
static func run_supply(state: GameState) -> void:
	for aid in state.sorted_army_ids():
		var a: Army = state.armies[aid]
		var n: Nation = state.nations[a.nation]
		if n.is_native:
			a.morale = min(max_morale(state, a), a.morale + 0.1)
			continue
		var need := a.weekly_need()
		for r in ["food", "arms"]:
			var got: float = min(float(a.supply.get(r, 0.0)), need[r])
			a.supply[r] = float(a.supply.get(r, 0.0)) - got
			if got > 0.0:
				state.ledger_add("army_consumption", r, -got)
			a.supply_ratio[r] = 1.0 if need[r] <= EPS else got / need[r]
		var mm := max_morale(state, a)
		if a.supply_ratio["food"] < 0.5:
			a.starving_weeks += 1
		else:
			a.starving_weeks = 0
		if a.starving_weeks >= int(GameData.bal("military.starving_weeks_for_attrition", 1)):
			var loss := a.total_strength() * GameData.balf("military.attrition_no_food", 0.04)
			apply_losses(a, loss)
			a.morale = max(0.0, a.morale - GameData.balf("military.morale_loss_no_food", 0.1))
			if not n.is_ai or a.starving_weeks == 1:
				state.log_event("danger", "%s 断粮，部队减员。" % a.name, [a.nation], a.province)
		elif state.turn - a.last_battle_turn > 0:
			var rec: float = GameData.balf("military.morale_recovery", 0.1) * (0.5 + 0.5 * float(a.supply_ratio["arms"]))
			a.morale = min(mm, a.morale + rec)
		if n.treasury < 0.0:
			a.morale = max(0.0, a.morale - GameData.balf("bankruptcy.morale_penalty", 0.05))
		a.morale = min(a.morale, mm)
		_reinforce(state, a)


static func _reinforce(state: GameState, a: Army) -> void:
	var p: Province = state.provinces[a.province]
	if p.controller != a.nation or a.supply_ratio["food"] < 0.99 or a.supply_ratio["arms"] < 0.99:
		return
	if state.turn - a.last_battle_turn <= 1:
		return
	var rate := GameData.balf("military.reinforce_rate", 0.1)
	for u in a.units.keys():
		var s := float(a.units[u])
		var full := ceilf(s - 0.001)
		var missing := full - s
		if missing <= 0.01:
			continue
		var add: float = min(missing, rate * full)
		var men := add * float(GameData.units[u]["manpower"])
		if manpower_available(state, a.nation) < men:
			continue
		var arms_need := add * float(GameData.units[u]["cost"].get("arms", 0.0)) * 0.5
		if float(a.supply.get("arms", 0.0)) < arms_need:
			continue
		a.supply["arms"] = float(a.supply["arms"]) - arms_need
		state.ledger_add("army_consumption", "arms", -arms_need)
		draw_manpower(state, a.nation, men)
		a.units[u] = s + add


static func army_speed(state: GameState, a: Army) -> float:
	return a.speed() * (1.0 + TechnologySystem.mod(state, a.nation, "speed_mult"))


static func run_movement(state: GameState) -> void:
	for aid in state.sorted_army_ids():
		var a: Army = state.armies.get(aid)
		if a == null or a.path.is_empty():
			continue
		var nxt: String = a.path[0]
		if not WorldMapSystem.are_adjacent(state, a.province, nxt) or not WorldMapSystem.can_enter(state, a.nation, nxt):
			a.path = []
			a.move_progress = 0.0
			continue
		# an army engaged in battle cannot march away except when retreating
		if a.in_battle:
			continue
		a.move_progress += army_speed(state, a)
		var cost := WorldMapSystem.move_cost(state, nxt)
		if a.move_progress + EPS >= cost:
			a.move_progress = 0.0
			a.province = nxt
			a.path.pop_front()
			a.arrived_turn = state.turn


## Sieges: an army alone in a province held by an enemy wears down its
## defences; at 100 progress control changes (occupation).
static func run_sieges(state: GameState) -> void:
	for pid in state.province_order:
		var p: Province = state.provinces[pid]
		var besiegers := {}
		var defenders := false
		for a: Army in state.armies_in(pid):
			if a.nation == p.controller or (not state.hostile(a.nation, p.controller)):
				if a.nation == p.controller:
					defenders = true
				continue
			besiegers[a.nation] = float(besiegers.get(a.nation, 0.0)) + _siege_power(state, a)
		if defenders or besiegers.is_empty():
			if p.siege.size() > 0:
				p.siege = {}
			continue
		# The incumbent besieger keeps its progress; otherwise the strongest
		# besieger (ties: lowest id) starts a new siege.
		var nid := ""
		if not p.siege.is_empty() and besiegers.has(p.siege["nation"]):
			nid = p.siege["nation"]
		else:
			var ids := besiegers.keys()
			ids.sort()
			for cand in ids:
				if nid == "" or float(besiegers[cand]) > float(besiegers[nid]) + EPS:
					nid = cand
			p.siege = {"nation": nid, "progress": 0.0}
		var fort_div := 1.0 + float(p.fort) * GameData.balf("military.siege_fort_factor", 1.0)
		var terr := 1.0 + float(GameData.terrain_def(p.terrain)["defense_bonus"])
		p.siege["progress"] = float(p.siege["progress"]) + GameData.balf("military.siege_base", 12.0) * besiegers[nid] / (fort_div * terr)
		if float(p.siege["progress"]) >= 100.0:
			occupy(state, p, nid)


static func _siege_power(state: GameState, a: Army) -> float:
	var s := 0.0
	for u in a.units.keys():
		s += float(a.units[u]) * float(GameData.units[u]["siege"]) * (1.0 + TechnologySystem.mod(state, a.nation, "siege_mult", u))
	var sup := 0.5 + 0.5 * float(a.supply_ratio.get("arms", 1.0))
	return s * sup * clampf(a.morale, 0.2, 1.2)


## Control of a province changes hands. Stock in the province becomes usable
## by the new controller, but part of it is destroyed in the fighting.
static func occupy(state: GameState, p: Province, nid: String) -> void:
	var old := p.controller
	var nat: Nation = state.nations[nid]
	var old_n: Nation = state.nations[old]
	p.siege = {}
	var destroy := GameData.balf("military.loot_destroy_ratio", 0.5)
	for r in p.stock.keys():
		var amt := p.get_stock(r) * destroy
		EconomySystem.remove_stock(state, p, r, amt, "war_destroyed")
	# remaining goods are captured: move the ledger entry from old to new controller
	for r in p.stock.keys():
		var amt2 := p.get_stock(r)
		if amt2 > 0.0:
			EconomySystem._record(state, old, "captured_out", r, -amt2)
			EconomySystem._record(state, nid, "captured_in", r, amt2)
	p.damage = min(1.0, p.damage + GameData.balf("military.occupation_damage", 0.25))
	p.stability = max(0.0, p.stability - GameData.balf("military.occupation_stability_loss", 30))
	var c := state.city_of(p.id)
	if c != null:
		for b: Building in c.buildings.values():
			if b.type != "road":
				b.damage = min(0.9, b.damage + GameData.balf("construction.occupied_damage", 0.2))
		c.satisfaction = max(0.0, c.satisfaction - 15.0)
	if old_n.is_native:
		# natives have no state to negotiate with: land is annexed immediately
		p.owner = nid
		p.controller = nid
		p.occupied_since = -1
		p.claim = {}
		state.log_event("war", "%s 征服了%s，该省并入版图。" % [nat.short_name, p.name], [nid], p.id)
	else:
		p.controller = nid
		p.occupied_since = state.turn if p.owner != nid else -1
		if p.owner == nid:
			state.log_event("war", "%s 收复了%s。" % [nat.short_name, p.name], [nid, old], p.id)
		else:
			state.log_event("war", "%s 攻占了%s（原属%s）。" % [nat.short_name, p.name, state.nations[p.owner].short_name], [nid, old], p.id)


## After peace, armies standing where they may no longer be are sent to the
## nearest province their nation controls.
static func evict_armies(state: GameState) -> void:
	for aid in state.sorted_army_ids():
		var a: Army = state.armies[aid]
		if state.nations[a.nation].is_native:
			continue
		if WorldMapSystem.can_enter(state, a.nation, a.province):
			continue
		var d := WorldMapSystem.hop_distances(state, a.province)
		var best := ""
		var bestd := 999
		for pid in state.provinces_controlled(a.nation):
			if int(d.get(pid, 999)) < bestd:
				bestd = int(d.get(pid, 999))
				best = pid
		if best == "":
			remove_army(state, a)
		else:
			a.province = best
			a.path = []
			a.move_progress = 0.0


static func merge_armies_in(state: GameState, nid: String, pid: String) -> Army:
	var list := state.armies_in(pid, nid)
	if list.is_empty():
		return null
	var main: Army = list[0]
	for i in range(1, list.size()):
		var o: Army = list[i]
		var ms := main.total_strength()
		var os := o.total_strength()
		for u in o.units.keys():
			main.units[u] = float(main.units.get(u, 0.0)) + float(o.units[u])
		if ms + os > EPS:
			main.morale = (main.morale * ms + o.morale * os) / (ms + os)
		for r in o.supply.keys():
			main.supply[r] = float(main.supply.get(r, 0.0)) + float(o.supply[r])
		o.supply = {"food": 0.0, "arms": 0.0}
		state.armies.erase(o.id)
	return main


static func cleanup(state: GameState) -> void:
	for aid in state.sorted_army_ids():
		var a: Army = state.armies[aid]
		for u in a.units.keys():
			if float(a.units[u]) < 0.01:
				a.units.erase(u)
		if a.is_empty():
			remove_army(state, a)
