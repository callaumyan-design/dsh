class_name CombatSystem
extends RefCounted
## Battle resolution. Each week hostile armies sharing a province fight up to
## `rounds_per_week` rounds. Per round each side deals
##   fire = Σ(regiments × attack × tech × terrain) × arms × food × morale × random
## and suffers   losses = casualty_rate × enemy_fire / own_toughness
## where toughness = average defence × (1 + terrain + fort [defender only]) × food.
## Morale falls with losses; a side below `break_morale` retreats.
## Every factor is written to the battle report so results are explainable.

const EPS := 0.0001


static func run(state: GameState) -> void:
	for a: Army in state.armies.values():
		a.in_battle = false
	for pid in state.province_order:
		var guard := 0
		while guard < 4:
			guard += 1
			var pair := _find_hostile_pair(state, pid)
			if pair.is_empty():
				break
			resolve(state, pid, pair[0], pair[1])


static func _find_hostile_pair(state: GameState, pid: String) -> Array:
	var present := []
	for a: Army in state.armies_in(pid):
		if not a.is_empty() and not present.has(a.nation):
			present.append(a.nation)
	present.sort()
	for i in range(present.size()):
		for j in range(i + 1, present.size()):
			if state.hostile(present[i], present[j]):
				return [present[i], present[j]]
	return []


static func side_factors(state: GameState, armies: Array, pid: String, defending: bool, enemy_has_artillery_share: float) -> Dictionary:
	var p: Province = state.provinces[pid]
	var terr: Dictionary = GameData.terrain_def(p.terrain)
	var cb: Dictionary = GameData.balance["combat"]
	var fire := 0.0
	var def_sum := 0.0
	var regs := 0.0
	var morale_w := 0.0
	var mm_w := 0.0
	var food := 0.0
	var arms := 0.0
	var nid: String = armies[0].nation
	var native := bool(state.nations[nid].is_native)
	var art := 0.0
	for a: Army in armies:
		var s := a.total_strength()
		regs += s
		morale_w += a.morale * s
		mm_w += MilitarySystem.max_morale(state, a) * s
		food += float(a.supply_ratio.get("food", 1.0)) * s if not native else s
		arms += float(a.supply_ratio.get("arms", 1.0)) * s if not native else s
		for u in a.units.keys():
			var st := float(a.units[u])
			var ud: Dictionary = GameData.units[u]
			if u == "artillery":
				art += st
			var atk := float(ud["attack"]) * (1.0 + TechnologySystem.mod(state, nid, "unit_attack_mult", u))
			atk *= 1.0 + float(ud.get("terrain_attack", {}).get(p.terrain, 0.0))
			var dfn := float(ud["defense"]) * (1.0 + TechnologySystem.mod(state, nid, "unit_defense_mult", u))
			if defending and p.owner == nid:
				dfn *= 1.0 + float(ud.get("home_defense_bonus", 0.0))
			fire += st * atk
			def_sum += st * dfn
	if regs <= EPS:
		return {"regs": 0.0}
	var morale := morale_w / regs
	var max_m := mm_w / regs
	var food_r := food / regs
	var arms_r := arms / regs
	var arms_f: float = cb["arms_attack_floor"] + (1.0 - cb["arms_attack_floor"]) * arms_r
	var food_f: float = cb["food_floor"] + (1.0 - cb["food_floor"]) * food_r
	var morale_f: float = cb["morale_floor"] + (1.0 - cb["morale_floor"]) * clampf(morale / max(max_m, 0.1), 0.0, 1.0)
	var terrain_b := 0.0
	var fort_b := 0.0
	if defending:
		terrain_b = float(terr["defense_bonus"])
		if p.controller == nid:
			fort_b = float(p.fort) * float(cb["fort_defense_per_level"]) * (1.0 - 0.5 * enemy_has_artillery_share)
	var toughness := def_sum / regs * (1.0 + terrain_b + fort_b) * food_f
	return {
		"nation": nid, "regs": regs, "base_fire": fire, "arms_f": arms_f, "food_f": food_f, "morale_f": morale_f,
		"fire": fire * arms_f * food_f * morale_f, "toughness": toughness, "terrain_b": terrain_b, "fort_b": fort_b,
		"morale": morale, "art_share": art / regs,
	}


static func resolve(state: GameState, pid: String, n1: String, n2: String) -> void:
	var cb: Dictionary = GameData.balance["combat"]
	var p: Province = state.provinces[pid]
	var a1 := state.armies_in(pid, n1)
	var a2 := state.armies_in(pid, n2)
	# Defender: the controller of the province, else whoever arrived first.
	var def_n := n2
	if p.controller == n1:
		def_n = n1
	elif p.controller != n2:
		var t1 := 999999
		var t2 := 999999
		for a: Army in a1:
			t1 = min(t1, a.arrived_turn)
		for a: Army in a2:
			t2 = min(t2, a.arrived_turn)
		def_n = n1 if t1 <= t2 else n2
	var att_n := n1 if def_n == n2 else n2
	var att: Array = a1 if att_n == n1 else a2
	var dfd: Array = a2 if att_n == n1 else a1
	for a: Army in att + dfd:
		a.in_battle = true
		a.last_battle_turn = state.turn
	var report := {
		"turn": state.turn, "province": pid, "attacker": att_n, "defender": def_n,
		"att_start": _strength(att), "def_start": _strength(dfd), "rounds": [], "winner": "", "result": "",
	}
	var att_men_lost := 0.0
	var def_men_lost := 0.0
	var rounds := int(cb["rounds_per_week"])
	var winner := ""
	for r in range(rounds):
		var fa := side_factors(state, att, pid, false, 0.0)
		var fd := side_factors(state, dfd, pid, true, float(fa.get("art_share", 0.0)))
		if fa["regs"] <= EPS or fd["regs"] <= EPS:
			break
		var ra := state.rand_range(cb["random_min"], cb["random_max"])
		var rd := state.rand_range(cb["random_min"], cb["random_max"])
		var fire_a: float = fa["fire"] * ra
		var fire_d: float = fd["fire"] * rd
		var loss_d: float = min(fd["regs"], float(cb["casualty_rate"]) * fire_a / max(fd["toughness"], 0.1))
		var loss_a: float = min(fa["regs"], float(cb["casualty_rate"]) * fire_d / max(fa["toughness"], 0.1))
		att_men_lost += _distribute(att, loss_a)
		def_men_lost += _distribute(dfd, loss_d)
		var mdmg_a: float = float(cb["morale_base_loss"]) + float(cb["morale_damage"]) * loss_a / max(fa["regs"], 0.1)
		var mdmg_d: float = float(cb["morale_base_loss"]) + float(cb["morale_damage"]) * loss_d / max(fd["regs"], 0.1)
		for a: Army in att:
			a.morale = max(0.0, a.morale - mdmg_a)
		for a: Army in dfd:
			a.morale = max(0.0, a.morale - mdmg_d)
		report["rounds"].append({
			"att_fire": fire_a, "def_fire": fire_d, "att_tough": fa["toughness"], "def_tough": fd["toughness"],
			"att_loss": loss_a, "def_loss": loss_d, "att_rand": ra, "def_rand": rd,
			"att_mods": {"arms": fa["arms_f"], "food": fa["food_f"], "morale": fa["morale_f"]},
			"def_mods": {"arms": fd["arms_f"], "food": fd["food_f"], "morale": fd["morale_f"], "terrain": fd["terrain_b"], "fort": fd["fort_b"]},
		})
		var att_m := _avg_morale(att)
		var def_m := _avg_morale(dfd)
		var att_dead := _strength(att) < 0.05
		var def_dead := _strength(dfd) < 0.05
		var att_broken: bool = att_dead or att_m < float(cb["break_morale"])
		var def_broken: bool = def_dead or def_m < float(cb["break_morale"])
		if att_broken or def_broken:
			if def_broken and not att_broken:
				winner = att_n
			elif att_broken and not def_broken:
				winner = def_n
			elif def_dead and not att_dead:
				winner = att_n
			elif att_m > def_m + 0.05 and not att_dead:
				winner = att_n
			else:
				winner = def_n
			break
	report["att_end"] = _strength(att)
	report["def_end"] = _strength(dfd)
	report["att_men_lost"] = att_men_lost
	report["def_men_lost"] = def_men_lost
	report["winner"] = winner
	var loser_list: Array = []
	if winner == att_n:
		loser_list = dfd
	elif winner == def_n:
		loser_list = att
	for a: Army in loser_list:
		_retreat(state, a)
	report["result"] = _result_text(state, report)
	MilitarySystem.cleanup(state)
	_war_score(state, att_n, def_n, att_men_lost, def_men_lost, winner)
	for nid in [att_n, def_n]:
		var nn: Nation = state.nations[nid]
		if not nn.is_native:
			nn.war_exhaustion += GameData.balf("war.exhaustion_per_casualty", 0.02) * (att_men_lost if nid == att_n else def_men_lost) / 10.0
	state.battle_reports.append(report)
	if state.battle_reports.size() > GameState.MAX_REPORTS:
		state.battle_reports = state.battle_reports.slice(state.battle_reports.size() - GameState.MAX_REPORTS)
	state.log_event("battle", report["result"], [att_n, def_n], pid)


static func _strength(list: Array) -> float:
	var s := 0.0
	for a: Army in list:
		s += a.total_strength()
	return s


static func _avg_morale(list: Array) -> float:
	var s := 0.0
	var w := 0.0
	for a: Army in list:
		var t: float = a.total_strength()
		s += a.morale * t
		w += t
	return s / w if w > EPS else 0.0


static func _distribute(list: Array, losses: float) -> float:
	var tot := _strength(list)
	if tot <= EPS:
		return 0.0
	var men := 0.0
	for a: Army in list:
		men += MilitarySystem.apply_losses(a, losses * a.total_strength() / tot)
	return men


## A beaten army falls back to an adjacent province its nation controls
## (nearest to its capital); with nowhere to go it surrenders.
static func _retreat(state: GameState, a: Army) -> void:
	if a.is_empty():
		return
	var n: Nation = state.nations[a.nation]
	if n.is_native:
		return  # natives fight to the end in their homeland but cannot flee
	var best := ""
	var best_d := 999
	var dist := WorldMapSystem.hop_distances(state, n.capital) if state.provinces.has(n.capital) else {}
	for nb in WorldMapSystem.neighbors(state, a.province):
		var p: Province = state.provinces[nb]
		if p.controller != a.nation:
			continue
		var hostile := false
		for o in state.armies_in(nb):
			if state.hostile(a.nation, o.nation):
				hostile = true
		if hostile:
			continue
		var d := int(dist.get(nb, 99))
		if d < best_d:
			best_d = d
			best = nb
	if best == "":
		state.log_event("battle", "%s 无路可退，全军投降！" % a.name, [a.nation], a.province)
		for u in a.units.keys():
			a.units[u] = 0.0
		return
	a.province = best
	a.path = []
	a.move_progress = 0.0
	a.arrived_turn = state.turn


static func _result_text(state: GameState, r: Dictionary) -> String:
	var pn: String = state.provinces[r["province"]].name
	var an: String = state.nations[r["attacker"]].short_name
	var dn: String = state.nations[r["defender"]].short_name
	var tail := "（%s损失%d人，%s损失%d人）" % [an, int(r["att_men_lost"]), dn, int(r["def_men_lost"])]
	if r["winner"] == r["attacker"]:
		return "%s之战：%s 击败了 %s %s" % [pn, an, dn, tail]
	if r["winner"] == r["defender"]:
		return "%s之战：%s 守住了阵地，%s 败退 %s" % [pn, dn, an, tail]
	return "%s之战：双方激战未分胜负 %s" % [pn, tail]


static func _war_score(state: GameState, att_n: String, def_n: String, att_lost: float, def_lost: float, winner: String) -> void:
	var w := state.find_war(att_n, def_n)
	if w.is_empty():
		return
	var cb: Dictionary = GameData.balance["combat"]
	var swing := (def_lost - att_lost) / 30.0 * float(cb["battle_score_scale"])
	if winner == att_n:
		swing += 2.0
	elif winner == def_n:
		swing -= 2.0
	swing = clampf(swing, -float(cb["battle_score_cap"]), float(cb["battle_score_cap"]))
	if w["attacker"] != att_n:
		swing = -swing
	w["battle_score"] = clampf(float(w["battle_score"]) + swing, -50.0, 50.0)
	w["battles"] = int(w["battles"]) + 1


## Pure estimate used by AI and UI: expected exchange ratio if `attackers`
## assault province `pid` held by `defenders` (no randomness, no state change).
static func estimate(state: GameState, attackers: Array, defenders: Array, pid: String) -> Dictionary:
	if attackers.is_empty():
		return {"ratio": 0.0, "att_fire": 0.0, "def_fire": 0.0}
	if defenders.is_empty():
		return {"ratio": 99.0, "att_fire": 1.0, "def_fire": 0.0}
	var fa := side_factors(state, attackers, pid, false, 0.0)
	var fd := side_factors(state, defenders, pid, true, float(fa.get("art_share", 0.0)))
	# damage each side inflicts relative to the other's size and toughness
	var dmg_a: float = fa["fire"] / max(fd["toughness"], 0.1) / max(fd["regs"], 0.1)
	var dmg_d: float = fd["fire"] / max(fa["toughness"], 0.1) / max(fa["regs"], 0.1)
	return {"ratio": dmg_a / max(dmg_d, 0.001), "att_fire": fa["fire"], "def_fire": fd["fire"]}
