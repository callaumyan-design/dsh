class_name VictorySystem
extends RefCounted
## Victory and defeat conditions (all thresholds in balance.json "victory").


static func run(state: GameState) -> void:
	if not state.game_over.is_empty():
		return
	var v: Dictionary = GameData.balance["victory"]
	var ids := state.active_nations()
	for nid in ids:
		var n: Nation = state.nations[nid]
		# --- lost all land
		if state.provinces_owned(nid).is_empty():
			n.eliminated = true
			_finish(state, _rival(state, nid), nid, "military", "%s 失去了全部领土，国家灭亡。" % n.name)
			return
		# --- capital held by the enemy
		var cap: Province = state.provinces.get(n.capital)
		if cap != null and cap.controller != nid:
			n.capital_lost_weeks += 1
		else:
			n.capital_lost_weeks = 0
		# --- capitulation: enemy holds our capital with enough war score
		for w in state.wars:
			if w["attacker"] != nid and w["defender"] != nid:
				continue
			var enemy := DiplomacySystem.other_side(w, nid)
			if cap != null and cap.controller == enemy:
				var sc := DiplomacySystem.score_for(w, enemy)
				if sc >= float(v["military"]["capitulation_score"]) or n.capital_lost_weeks >= int(v["defeat"]["capital_lost_weeks"]):
					_finish(state, enemy, nid, "military", "%s 攻占首都%s，%s 被迫投降！" % [state.nations[enemy].short_name, cap.name, n.name])
					return
		# --- bankruptcy collapse
		var bk: Dictionary = GameData.balance["bankruptcy"]
		if n.debt_weeks >= int(bk["collapse_weeks"]) and n.treasury <= float(bk["collapse_debt"]):
			_finish(state, _rival(state, nid), nid, "collapse", "%s 长期严重破产，政府崩溃。" % n.name)
			return
	for nid in ids:
		var n2: Nation = state.nations[nid]
		# --- economic victory
		var ev: Dictionary = v["economic"]
		var net := float(n2.finance.get("net", 0.0))
		if EconomySystem.industry_index(state, nid) >= float(ev["industry_target"]) and n2.treasury >= float(ev["treasury_min"]) and net >= 0.0 and n2.debt_weeks == 0:
			n2.econ_victory_weeks += 1
		else:
			n2.econ_victory_weeks = 0
		if n2.econ_victory_weeks >= int(ev["stable_weeks"]):
			_finish(state, nid, _rival(state, nid), "economic", "%s 建立了无可匹敌的工业与财政体系，取得经济霸权！" % n2.name)
			return
		# --- hegemony
		var hv: Dictionary = v["hegemony"]
		var share := float(state.provinces_controlled(nid).size()) / float(state.province_order.size())
		if share >= float(hv["province_share"]) and n2.techs.size() >= int(hv["techs_required"]) and n2.treasury >= 0.0:
			n2.hegemony_weeks += 1
		else:
			n2.hegemony_weeks = 0
		if n2.hegemony_weeks >= int(hv["stable_weeks"]):
			_finish(state, nid, _rival(state, nid), "hegemony", "%s 凭借领土、科技与财政建立了综合霸权！" % n2.name)
			return


static func _rival(state: GameState, nid: String) -> String:
	for o in state.active_nations():
		if o != nid:
			return o
	return ""


static func _finish(state: GameState, winner: String, loser: String, type: String, reason: String) -> void:
	state.game_over = {"winner": winner, "loser": loser, "type": type, "reason": reason, "turn": state.turn}
	state.log_event("victory", reason, [winner, loser])


static func progress(state: GameState, nid: String) -> Dictionary:
	var v: Dictionary = GameData.balance["victory"]
	var n: Nation = state.nations[nid]
	return {
		"industry": EconomySystem.industry_index(state, nid), "industry_target": float(v["economic"]["industry_target"]),
		"treasury": n.treasury, "treasury_min": float(v["economic"]["treasury_min"]),
		"econ_weeks": n.econ_victory_weeks, "econ_weeks_needed": int(v["economic"]["stable_weeks"]),
		"provinces": state.provinces_controlled(nid).size(), "province_total": state.province_order.size(),
		"techs": n.techs.size(), "techs_needed": int(v["hegemony"]["techs_required"]),
		"hegemony_weeks": n.hegemony_weeks, "hegemony_needed": int(v["hegemony"]["stable_weeks"]),
	}
