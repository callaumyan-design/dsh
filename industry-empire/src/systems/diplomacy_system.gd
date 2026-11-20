class_name DiplomacySystem
extends RefCounted
## Relations, wars, war score, peace treaties, trade agreements and claims
## on neutral provinces.

const EPS := 0.0001


# ---------------------------------------------------------------- war

static func can_declare_war(state: GameState, a: String, b: String, goal: String) -> Dictionary:
	var na: Nation = state.nations.get(a)
	var nb: Nation = state.nations.get(b)
	if na == null or nb == null or not na.is_active() or not nb.is_active() or a == b:
		return {"ok": false, "reason": "无效的目标国家"}
	if state.at_war(a, b):
		return {"ok": false, "reason": "已经处于战争状态"}
	var truce := state.find_treaty("truce", a, b)
	if not truce.is_empty():
		return {"ok": false, "reason": "停战协定生效中（剩余%d周）" % (int(truce["end"]) - state.turn)}
	if state.get_relation(a, b) > GameData.balf("war.declare_war_max_relation", 30):
		return {"ok": false, "reason": "两国关系过好（>%d），找不到开战理由" % int(GameData.balf("war.declare_war_max_relation", 30))}
	var p: Province = state.provinces.get(goal)
	if p == null or p.owner != b:
		return {"ok": false, "reason": "战争目标必须是对方拥有的省份"}
	return {"ok": true, "reason": ""}


static func declare_war(state: GameState, a: String, b: String, goal: String) -> Dictionary:
	var chk := can_declare_war(state, a, b, goal)
	if not chk["ok"]:
		return chk
	var w := {"id": state.next_war_id, "attacker": a, "defender": b, "goal": goal, "start": state.turn,
		"battle_score": 0.0, "score": 0.0, "battles": 0}
	state.next_war_id += 1
	state.wars.append(w)
	state.set_relation(a, b, state.get_relation(a, b) + GameData.balf("war.relation_on_war", -60))
	var t := state.find_treaty("trade", a, b)
	if not t.is_empty():
		state.treaties.erase(t)
	state.proposals = state.proposals.filter(func(pr): return not ((pr["from"] == a and pr["to"] == b) or (pr["from"] == b and pr["to"] == a)))
	state.log_event("war", "%s 向 %s 宣战！战争目标：%s" % [state.nations[a].short_name, state.nations[b].short_name, state.provinces[goal].name], [a, b], goal)
	return {"ok": true, "reason": "", "war": w}


## Share (0..100) of `victim`'s province value controlled by `occupier`.
static func occupation_pct(state: GameState, occupier: String, victim: String) -> float:
	var total := 0.0
	var held := 0.0
	for pid in state.province_order:
		var p: Province = state.provinces[pid]
		if p.owner != victim:
			continue
		var v := WorldMapSystem.province_value(state, pid)
		total += v
		if p.controller == occupier:
			held += v
	return 100.0 * held / total if total > 0.0 else 0.0


static func update_war_scores(state: GameState) -> void:
	for w in state.wars:
		w["battle_score"] = float(w["battle_score"]) * (1.0 - GameData.balf("war.battle_score_decay", 0.02))
		var occ := occupation_pct(state, w["attacker"], w["defender"]) - occupation_pct(state, w["defender"], w["attacker"])
		w["score"] = clampf(float(w["battle_score"]) + occ, -100.0, 100.0)
	for nid in state.active_nations():
		var n: Nation = state.nations[nid]
		if state.is_at_war(nid):
			n.war_exhaustion += GameData.balf("war.exhaustion_per_week", 0.4)
			for pid in state.provinces_owned(nid):
				if state.provinces[pid].is_occupied():
					n.war_exhaustion += GameData.balf("war.exhaustion_per_occupied", 0.3)
		else:
			n.war_exhaustion = max(0.0, n.war_exhaustion - 0.5)
		n.war_exhaustion = clampf(n.war_exhaustion, 0.0, 100.0)


## War score from `nid`'s point of view.
static func score_for(w: Dictionary, nid: String) -> float:
	return float(w["score"]) if w["attacker"] == nid else -float(w["score"])


static func other_side(w: Dictionary, nid: String) -> String:
	return w["defender"] if w["attacker"] == nid else w["attacker"]


# ---------------------------------------------------------------- peace

## terms: {"type": "white"} | {"type": "demand", "provinces": [...], "reparations": int}
## `from` proposes to `to`; demands are made by `from` on `to`.
static func validate_terms(state: GameState, w: Dictionary, from: String, terms: Dictionary) -> Dictionary:
	var to := other_side(w, from)
	if terms.get("type", "white") == "white":
		return {"ok": true, "reason": "", "cost": 0.0}
	var cost := 0.0
	for pid in terms.get("provinces", []):
		var p: Province = state.provinces.get(pid)
		if p == null or p.owner != to:
			return {"ok": false, "reason": "只能索取对方拥有的省份"}
		if p.controller != from:
			return {"ok": false, "reason": "%s 尚未被你占领，不能索取" % p.name}
		if state.nations[to].capital == pid:
			return {"ok": false, "reason": "不能通过和约索取首都（攻占首都可迫使对方投降）"}
		cost += peace_cost_province(state, pid)
	var rep := float(terms.get("reparations", 0))
	if rep < 0.0:
		return {"ok": false, "reason": "赔款不能为负"}
	cost += rep / 100.0 * GameData.balf("war.reparations_score_per_100", 4)
	if cost > max(0.0, score_for(w, from)) + EPS:
		return {"ok": false, "reason": "战争分数不足（需要%d，当前%d）" % [int(ceil(cost)), int(score_for(w, from))], "cost": cost}
	return {"ok": true, "reason": "", "cost": cost}


static func peace_cost_province(state: GameState, pid: String) -> float:
	var owner: String = state.provinces[pid].owner
	var total := 0.0
	for q in state.provinces_owned(owner):
		total += WorldMapSystem.province_value(state, q)
	return 100.0 * WorldMapSystem.province_value(state, pid) / max(total, 1.0)


## Decision of an AI nation `to` on terms proposed by `from`.
static func ai_accepts_peace(state: GameState, w: Dictionary, from: String, terms: Dictionary) -> bool:
	var to := other_side(w, from)
	var n: Nation = state.nations[to]
	var pers: Dictionary = GameData.ai["personalities"].get(n.personality, {})
	var my_score := score_for(w, to)
	var exhaustion_push := n.war_exhaustion * 0.6
	var capital_lost: bool = state.provinces.has(n.capital) and state.provinces[n.capital].controller != to
	if terms.get("type", "white") == "white":
		# accept white peace unless clearly winning
		var threshold := 10.0 + float(pers.get("peace_bias", 0.0)) * 20.0 + exhaustion_push
		return my_score <= threshold
	var chk := validate_terms(state, w, from, terms)
	if not chk["ok"]:
		return false
	var cost: float = chk["cost"]
	var tolerance := -my_score + exhaustion_push * 0.5 + (25.0 if capital_lost else 0.0)
	return cost <= tolerance + EPS


static func make_peace(state: GameState, w: Dictionary, from: String, terms: Dictionary) -> void:
	var to := other_side(w, from)
	var ceded := []
	if terms.get("type", "white") == "demand":
		for pid in terms.get("provinces", []):
			var p: Province = state.provinces[pid]
			p.owner = from
			p.controller = from
			p.occupied_since = -1
			p.siege = {}
			ceded.append(p.name)
		var rep := float(terms.get("reparations", 0))
		if rep > 0.0:
			var weeks := int(GameData.bal("war.reparations_weeks", 10))
			state.treaties.append({"type": "reparations", "a": to, "b": from, "start": state.turn, "end": state.turn + weeks,
				"per_week": rep / weeks, "weeks_left": weeks})
	# all other occupations end
	for pid in state.province_order:
		var p2: Province = state.provinces[pid]
		if (p2.owner == from and p2.controller == to) or (p2.owner == to and p2.controller == from):
			p2.controller = p2.owner
			p2.occupied_since = -1
			p2.siege = {}
	state.wars.erase(w)
	state.treaties.append({"type": "truce", "a": from, "b": to, "start": state.turn,
		"end": state.turn + int(GameData.bal("war.truce_weeks", 20)), "per_week": 0.0, "weeks_left": 0})
	state.proposals = state.proposals.filter(func(pr): return not (pr["type"] == "peace" and pr.get("war_id", -1) == w["id"]))
	MilitarySystem.evict_armies(state)
	var txt := "%s 与 %s 签订和约" % [state.nations[from].short_name, state.nations[to].short_name]
	if ceded.size() > 0:
		txt += "，割让：" + "、".join(ceded)
	if float(terms.get("reparations", 0)) > 0.0:
		txt += "，赔款 %d" % int(terms["reparations"])
	if terms.get("type", "white") == "white":
		txt += "（白色和平）"
	state.log_event("diplomacy", txt + "。", [from, to])


## Proposes peace. AI targets answer immediately; the human player gets a
## pending proposal to accept or decline in the diplomacy screen.
static func propose_peace(state: GameState, from: String, to: String, terms: Dictionary) -> Dictionary:
	var w := state.find_war(from, to)
	if w.is_empty():
		return {"ok": false, "reason": "两国并未交战"}
	var chk := validate_terms(state, w, from, terms)
	if not chk["ok"]:
		return chk
	if state.nations[to].is_ai:
		if ai_accepts_peace(state, w, from, terms):
			make_peace(state, w, from, terms)
			return {"ok": true, "accepted": true, "reason": ""}
		return {"ok": true, "accepted": false, "reason": "%s 拒绝了和平提议" % state.nations[to].short_name}
	_add_proposal(state, from, to, "peace", terms, w["id"])
	return {"ok": true, "accepted": false, "pending": true, "reason": ""}


# ---------------------------------------------------------------- trade agreements

static func ai_accepts_trade(state: GameState, from: String, to: String) -> bool:
	var n: Nation = state.nations[to]
	var pers: Dictionary = GameData.ai["personalities"].get(n.personality, {})
	var rel := state.get_relation(from, to)
	if rel < GameData.balf("diplomacy.trade_min_relation", -20):
		return false
	if n.ai_memory.get("war_plan_target", "") == from:
		return false
	var utility := float(pers.get("commerce", 1.0)) * 10.0 + rel * 0.3
	# landlocked nations value market access more
	if EconomySystem.market_capacity(state, to) < GameData.balf("market.coastal_capacity", 12):
		utility += 8.0
	return utility > 5.0


static func propose_trade(state: GameState, from: String, to: String) -> Dictionary:
	if state.at_war(from, to):
		return {"ok": false, "reason": "交战中无法签订贸易协定"}
	if state.has_treaty("trade", from, to):
		return {"ok": false, "reason": "已有贸易协定"}
	if state.get_relation(from, to) < GameData.balf("diplomacy.trade_min_relation", -20):
		return {"ok": false, "reason": "关系过差（低于%d）" % int(GameData.balf("diplomacy.trade_min_relation", -20))}
	if state.nations[to].is_ai:
		if ai_accepts_trade(state, from, to):
			sign_trade(state, from, to)
			return {"ok": true, "accepted": true, "reason": ""}
		return {"ok": true, "accepted": false, "reason": "%s 拒绝了贸易协定" % state.nations[to].short_name}
	_add_proposal(state, from, to, "trade", {}, -1)
	return {"ok": true, "accepted": false, "pending": true, "reason": ""}


static func sign_trade(state: GameState, a: String, b: String) -> void:
	state.treaties.append({"type": "trade", "a": a, "b": b, "start": state.turn, "end": -1, "per_week": 0.0, "weeks_left": 0})
	state.set_relation(a, b, state.get_relation(a, b) + 10.0)
	state.log_event("diplomacy", "%s 与 %s 签订贸易协定：双方市场容量与税收提升。" % [state.nations[a].short_name, state.nations[b].short_name], [a, b])


static func cancel_trade(state: GameState, a: String, b: String) -> Dictionary:
	var t := state.find_treaty("trade", a, b)
	if t.is_empty():
		return {"ok": false, "reason": "没有贸易协定"}
	state.treaties.erase(t)
	state.set_relation(a, b, state.get_relation(a, b) - 10.0)
	state.log_event("diplomacy", "%s 终止了与 %s 的贸易协定。" % [state.nations[a].short_name, state.nations[b].short_name], [a, b])
	return {"ok": true, "reason": ""}


# ---------------------------------------------------------------- proposals

static func _add_proposal(state: GameState, from: String, to: String, type: String, terms: Dictionary, war_id: int) -> void:
	for pr in state.proposals:
		if pr["from"] == from and pr["to"] == to and pr["type"] == type:
			return
	state.proposals.append({"id": state.next_proposal_id, "from": from, "to": to, "type": type, "terms": terms,
		"war_id": war_id, "expires": state.turn + 4})
	state.next_proposal_id += 1
	var desc := "贸易协定" if type == "trade" else "和平条约"
	state.log_event("diplomacy", "%s 向你提议：%s" % [state.nations[from].short_name, desc], [from, to])


static func respond(state: GameState, proposal_id: int, accept: bool) -> Dictionary:
	var pr := {}
	for p in state.proposals:
		if int(p["id"]) == proposal_id:
			pr = p
	if pr.is_empty():
		return {"ok": false, "reason": "提议已失效"}
	state.proposals.erase(pr)
	if not accept:
		state.set_relation(pr["from"], pr["to"], state.get_relation(pr["from"], pr["to"]) - 3.0)
		state.log_event("diplomacy", "你拒绝了 %s 的提议。" % state.nations[pr["from"]].short_name, [pr["from"], pr["to"]])
		return {"ok": true, "reason": ""}
	if pr["type"] == "trade":
		if state.at_war(pr["from"], pr["to"]) or state.has_treaty("trade", pr["from"], pr["to"]):
			return {"ok": false, "reason": "条件已变化"}
		sign_trade(state, pr["from"], pr["to"])
	elif pr["type"] == "peace":
		var w := state.find_war(pr["from"], pr["to"])
		if w.is_empty():
			return {"ok": false, "reason": "战争已结束"}
		var chk := validate_terms(state, w, pr["from"], pr["terms"])
		if not chk["ok"]:
			return {"ok": false, "reason": "条款已失效：" + chk["reason"]}
		make_peace(state, w, pr["from"], pr["terms"])
	return {"ok": true, "reason": ""}


# ---------------------------------------------------------------- claims on neutral land

static func claim_cost(state: GameState, pid: String) -> float:
	var p: Province = state.provinces[pid]
	var garrison := 0.0
	for a: Army in state.armies_in(pid):
		if state.nations[a.nation].is_native:
			garrison += a.total_strength()
	return GameData.balf("claims.cost_base", 150) + GameData.balf("claims.cost_per_dev", 40) * p.development + GameData.balf("claims.cost_per_garrison", 30) * garrison


static func can_claim(state: GameState, nid: String, pid: String) -> Dictionary:
	var p: Province = state.provinces.get(pid)
	if p == null or not state.nations[p.owner].is_native or p.controller != p.owner:
		return {"ok": false, "reason": "只能和平并入中立部落的领地"}
	if not p.claim.is_empty():
		return {"ok": false, "reason": "%s 正在并入该地区" % state.nations[p.claim["nation"]].short_name}
	if not WorldMapSystem.borders_nation(state, pid, nid):
		return {"ok": false, "reason": "必须与本国控制的省份接壤"}
	var cost := claim_cost(state, pid)
	if state.nations[nid].treasury < cost:
		return {"ok": false, "reason": "需要 %d 金钱" % int(cost)}
	return {"ok": true, "reason": "", "cost": cost}


static func start_claim(state: GameState, nid: String, pid: String) -> Dictionary:
	var chk := can_claim(state, nid, pid)
	if not chk["ok"]:
		return chk
	var n: Nation = state.nations[nid]
	EconomySystem.spend(n, chk["cost"], "claims")
	var p: Province = state.provinces[pid]
	p.claim = {"nation": nid, "weeks_left": int(GameData.bal("claims.weeks", 6))}
	for other in state.active_nations():
		if other != nid and WorldMapSystem.borders_nation(state, pid, other):
			state.set_relation(nid, other, state.get_relation(nid, other) + GameData.balf("diplomacy.claim_relation_penalty", -10))
	state.log_event("diplomacy", "%s 开始和平并入%s（%d 周）。" % [n.short_name, p.name, p.claim["weeks_left"]], [nid], pid)
	return {"ok": true, "reason": ""}


static func _advance_claims(state: GameState) -> void:
	for pid in state.province_order:
		var p: Province = state.provinces[pid]
		if p.claim.is_empty():
			continue
		if not state.nations[p.owner].is_native:
			p.claim = {}
			continue
		p.claim["weeks_left"] = int(p.claim["weeks_left"]) - 1
		if int(p.claim["weeks_left"]) <= 0:
			var nid: String = p.claim["nation"]
			for a: Army in state.armies_in(pid):
				if state.nations[a.nation].is_native:
					MilitarySystem.remove_army(state, a)
			p.owner = nid
			p.controller = nid
			p.claim = {}
			p.siege = {}
			state.log_event("diplomacy", "%s 已和平并入%s。" % [state.nations[nid].short_name, p.name], [nid], pid)


# ---------------------------------------------------------------- weekly

static func run(state: GameState) -> void:
	var dp: Dictionary = GameData.balance["diplomacy"]
	var ids := state.active_nations()
	for i in range(ids.size()):
		for j in range(i + 1, ids.size()):
			var a: String = ids[i]
			var b: String = ids[j]
			var rel := state.get_relation(a, b)
			if state.at_war(a, b):
				rel -= 0.5
			elif state.has_treaty("trade", a, b):
				rel += min(float(dp["trade_relation_bonus"]), max(0.0, float(dp["trade_relation_target"]) - rel))
			else:
				rel += clampf(-rel, -float(dp["relation_drift"]), float(dp["relation_drift"]))
			# armies massed on the border create tension
			for army in state.armies_of(a):
				if state.provinces[army.province].controller == a and WorldMapSystem.borders_nation(state, army.province, b) and army.total_strength() >= 5.0:
					rel += float(dp["border_tension"])
			state.set_relation(a, b, rel)
	var keep := []
	for t in state.treaties:
		if t["type"] == "truce" and state.turn >= int(t["end"]):
			state.log_event("diplomacy", "%s 与 %s 的停战协定到期。" % [state.nations[t["a"]].short_name, state.nations[t["b"]].short_name], [t["a"], t["b"]])
			continue
		if t["type"] == "reparations":
			var payer: Nation = state.nations[t["a"]]
			var payee: Nation = state.nations[t["b"]]
			EconomySystem.spend(payer, t["per_week"], "reparations")
			EconomySystem.earn(payee, t["per_week"], "reparations")
			t["weeks_left"] = int(t["weeks_left"]) - 1
			if int(t["weeks_left"]) <= 0:
				continue
		keep.append(t)
	state.treaties = keep
	state.proposals = state.proposals.filter(func(pr): return int(pr["expires"]) > state.turn)
	_advance_claims(state)
