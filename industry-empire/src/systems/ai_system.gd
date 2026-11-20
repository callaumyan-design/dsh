class_name AISystem
extends RefCounted
## Rule-driven utility AI. Each week every AI nation analyses its economy and
## the strategic situation, scores possible actions (benefit - cost - risk,
## weighted by personality) and executes the best ones through Commands —
## exactly the same API and costs as the human player. No hidden bonuses.

const EPS := 0.0001


static func run(state: GameState) -> void:
	for nid in state.active_nations():
		var n: Nation = state.nations[nid]
		if n.is_ai and state.game_over.is_empty():
			think(state, nid)


static func think(state: GameState, nid: String) -> void:
	var n: Nation = state.nations[nid]
	var ctx := analyze(state, nid)
	var log: Array = []
	_finance(state, n, ctx, log)
	_research(state, n, ctx, log)
	_diplomacy(state, n, ctx, log)
	_economy(state, n, ctx, log)
	_market(state, n, ctx, log)
	_military(state, n, ctx, log)
	n.ai_memory["last_log"] = log
	n.ai_memory["last_think"] = state.turn


static func pers(n: Nation, key: String, default_value := 1.0) -> float:
	return float(GameData.ai["personalities"].get(n.personality, {}).get(key, default_value))


static func plan(key: String) -> float:
	return float(GameData.ai["planning"][key])


# ---------------------------------------------------------------- analysis

static func analyze(state: GameState, nid: String) -> Dictionary:
	var n: Nation = state.nations[nid]
	var ctx := {}
	var cap: Province = state.provinces.get(n.capital)
	ctx["capital"] = cap
	ctx["city"] = state.city_of(n.capital) if cap != null and cap.controller == nid else null
	ctx["stock"] = EconomySystem.nation_stock(state, nid)
	ctx["net"] = EconomySystem.projected_net(state, nid)
	var rival := ""
	var rival_power := 0.0
	for o in state.active_nations():
		if o == nid:
			continue
		var pw := MilitarySystem.nation_power(state, o)
		if rival == "" or pw > rival_power:
			rival = o
			rival_power = pw
	ctx["rival"] = rival
	ctx["rival_power"] = rival_power
	ctx["own_power"] = MilitarySystem.nation_power(state, nid)
	var threat := 0.0
	for pid in state.provinces_controlled(nid):
		for nb in WorldMapSystem.neighbors(state, pid) + [pid]:
			for a: Army in state.armies_in(nb):
				if a.nation != nid and not state.nations[a.nation].is_native:
					if state.at_war(nid, a.nation) or a.nation == rival:
						threat += MilitarySystem.army_power(state, a) * (1.0 if state.at_war(nid, a.nation) else 0.5)
	ctx["threat"] = threat / 2.0
	ctx["war"] = state.find_war(nid, rival) if rival != "" else {}
	var army_need := {"food": 0.0, "arms": 0.0}
	var regs := 0.0
	for a: Army in state.armies_of(nid):
		var nd := a.weekly_need()
		army_need["food"] += nd["food"]
		army_need["arms"] += nd["arms"]
		regs += a.total_strength()
	ctx["army_need"] = army_need
	ctx["regiments"] = regs
	ctx["balance"] = _nominal_balance(state, nid, ctx)
	return ctx


## Planned weekly production minus consumption per resource, counting
## buildings under construction so the AI does not over-build.
static func _nominal_balance(state: GameState, nid: String, ctx: Dictionary) -> Dictionary:
	var bal := {}
	for r in GameData.RESOURCE_IDS:
		bal[r] = 0.0
	for pid in state.provinces_controlled(nid):
		var p: Province = state.provinces[pid]
		for r in p.last_output.keys():
			bal[r] += float(p.last_output[r])
	var c: City = ctx["city"]
	if c != null:
		for bid in c.sorted_ids():
			var b: Building = c.buildings[bid]
			var d: Dictionary = b.def()
			if d["stage"] < 0:
				continue
			var site := CitySystem.site_factor(c, b)
			var thr := 1.0 + TechnologySystem.mod(state, nid, "throughput_mult", d.get("category", ""))
			var om := 1.0 + TechnologySystem.mod(state, nid, "output_mult", b.type)
			for r in d["outputs"].keys():
				bal[r] += float(d["outputs"][r]) * site * thr * om
			for r in d["inputs"].keys():
				bal[r] -= float(d["inputs"][r]) * thr * max(0.0, 1.0 + TechnologySystem.mod(state, nid, "input_mult", b.type, r))
		bal["food"] -= c.pop * GameData.balf("population.food_per_pop", 0.05) * 1.1
	bal["food"] -= float(ctx["army_need"]["food"])
	bal["arms"] -= float(ctx["army_need"]["arms"])
	bal["wood"] -= 2.0   # construction usage
	bal["stone"] -= 1.5
	return bal


# ---------------------------------------------------------------- finance & research

static func _finance(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var c: City = ctx["city"]
	var sat := c.satisfaction if c != null else 60.0
	var net: float = ctx["net"]
	if n.treasury < 120.0 and net < 0.0:
		if n.research_funding > 0:
			Commands.set_research_funding(state, n.id, 0)
			log.append("财政紧张：暂停科研投入")
		if n.tax_policy != "high" and sat >= 50.0:
			Commands.set_tax(state, n.id, "high")
			log.append("财政紧张：提高税率")
		if not state.is_at_war(n.id) and net < -10.0:
			_disband_militia(state, n, log)
	elif n.treasury > 500.0 and net > 5.0:
		var want := clampi(int(round(pers(n, "science") * 2.0)), 1, 3)
		if n.research_funding < want:
			Commands.set_research_funding(state, n.id, want)
		if n.tax_policy == "high" and sat < 55.0:
			Commands.set_tax(state, n.id, "normal")
	elif n.treasury > 250.0 and n.research_funding == 0:
		Commands.set_research_funding(state, n.id, 1)
	if sat < 30.0 and n.tax_policy == "high":
		Commands.set_tax(state, n.id, "normal")
		log.append("民心不稳：恢复常税")
	elif sat < 22.0 and n.tax_policy == "normal" and n.treasury > 200.0:
		Commands.set_tax(state, n.id, "low")


static func _disband_militia(state: GameState, n: Nation, log: Array) -> void:
	for a: Army in state.armies_of(n.id):
		if float(a.units.get("militia", 0.0)) >= 1.0 and state.provinces[a.province].controller == n.id:
			Commands.disband(state, n.id, a.id, "militia", 1.0)
			log.append("裁撤一团民兵以节省开支")
			return


static func _research(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	if n.research_target != "" and TechnologySystem.can_research(state, n.id, n.research_target):
		return
	var best := ""
	var best_u := -1e9
	var bal: Dictionary = ctx["balance"]
	for tid in TechnologySystem.available(state, n.id):
		var t: Dictionary = GameData.techs[tid]
		var w := 1.0
		match t["branch"]:
			"经济":
				w = pers(n, "commerce")
			"工业":
				w = pers(n, "industry")
			"军事":
				w = pers(n, "military") * (1.5 if state.is_at_war(n.id) else 1.0)
		if tid == "agri_improve" and bal["food"] < 2.0:
			w += 0.8
		if tid == "storage" and _storage_pressure(state, ctx) > 0.8:
			w += 0.8
		var u := w * 100.0 / float(t["cost"])
		if u > best_u:
			best_u = u
			best = tid
	if best != "":
		Commands.set_research(state, n.id, best)
		log.append("研究方向：" + GameData.techs[best]["name"])


static func _storage_pressure(state: GameState, ctx: Dictionary) -> float:
	var cap: Province = ctx["capital"]
	if cap == null:
		return 0.0
	var c := EconomySystem.storage_cap(state, cap)
	var m := 0.0
	for r in GameData.RESOURCE_IDS:
		m = max(m, cap.get_stock(r) / max(c, 1.0))
	return m


# ---------------------------------------------------------------- economy (construction)

static func _economy(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var c: City = ctx["city"]
	if c == null:
		return
	var tried := {}
	var builds := 0
	for i in range(5):
		if builds >= int(plan("max_builds_per_turn")):
			break
		var cands := _building_candidates(state, n, ctx, c)
		var picked := ""
		for cand in cands:
			if not tried.has(cand[1]):
				picked = cand[1]
				break
		if picked == "":
			break
		tried[picked] = true
		if _try_build(state, n, c, picked, log):
			builds += 1
			ctx["balance"] = _nominal_balance(state, n.id, ctx)


## Returns [[utility, type], ...] sorted best first.
static func _building_candidates(state: GameState, n: Nation, ctx: Dictionary, c: City) -> Array:
	var bal: Dictionary = ctx["balance"]
	var out := []
	var labor := EconomySystem.labor_total(c)
	var demand := 0
	for b: Building in c.buildings.values():
		demand += int(b.def()["workers"]) if b.enabled else 0
	var free_labor := labor - demand
	var housing_planned := 0.0
	for b: Building in c.buildings.values():
		housing_planned += float(b.def().get("housing", 0))
	var room := housing_planned - c.pop
	var ind := pers(n, "industry")
	var mil := pers(n, "military") * (1.6 if state.is_at_war(n.id) else 1.0)
	var at_war := state.is_at_war(n.id)
	# --- food chain
	if bal["food"] < 2.0:
		out.append([12.0 + (2.0 - bal["food"]) * 3.0, "food_workshop"])
	if bal["grain"] < 2.0:
		out.append([10.0 + (2.0 - bal["grain"]) * 2.0, "farm"])
	# --- housing / labour
	if free_labor < 14 and room < 15.0 and bal["food"] > -1.0:
		out.append([13.0, "residence"])
	elif room < 5.0 and bal["food"] > 1.0:
		out.append([7.0, "residence"])
	# --- basic materials
	if bal["wood"] < 1.0:
		out.append([7.0 + (1.0 - bal["wood"]) * 2.0, "lumber_camp"])
	if bal["stone"] < 0.5 and ctx["stock"]["stone"] < 60.0:
		out.append([6.0 + (0.5 - bal["stone"]) * 2.0, "quarry"])
	# --- heavy industry
	var mills := c.count_type("steel_mill")
	var arsenals := c.count_type("arsenal")
	var want_mills := 1 + (1 if c.pop > 330.0 and ind >= 1.0 else 0)
	if state.turn >= 2:
		if mills > 0 or bal["coal"] < 2.0:
			if bal["coal"] < 0.5:
				out.append([8.0 * ind + (0.5 - bal["coal"]), "coal_mine"])
		if mills > 0 or bal["iron"] < 2.0:
			if bal["iron"] < 0.5:
				out.append([8.0 * ind + (0.5 - bal["iron"]), "iron_mine"])
		if mills < want_mills and (bal["coal"] >= 1.5 or c.count_type("coal_mine") > 0) and (bal["iron"] >= 1.5 or c.count_type("iron_mine") > 0):
			out.append([10.0 * ind, "steel_mill"])
		var want_ars := 1 + (1 if (at_war or mil >= 1.2) and c.pop > 300.0 else 0)
		if arsenals < want_ars and mills > 0 and (bal["steel"] >= 0.8 or at_war):
			out.append([10.0 * mil, "arsenal"])
	if c.count_type("barracks") == 0 and state.turn >= 3:
		out.append([(9.0 if at_war or ctx["threat"] > ctx["own_power"] * 0.5 else 6.0) * mil, "barracks"])
	if _storage_pressure(state, ctx) > 0.85 and c.count_type("warehouse") < 4:
		out.append([8.0, "warehouse"])
	# labour gate: jobs without workers are worthless — build homes first
	var gated := []
	for cand in out:
		var w: int = GameData.buildings[cand[1]]["workers"]
		if w > free_labor and cand[1] != "residence":
			cand[0] = cand[0] * 0.3
			if room < 10.0 and bal["food"] > -2.0:
				gated.append([cand[0] + 2.0, "residence"])
		gated.append(cand)
	gated.sort_custom(func(a, b): return a[0] > b[0] or (a[0] == b[0] and a[1] < b[1]))
	return gated


static func _try_build(state: GameState, n: Nation, c: City, type: String, log: Array) -> bool:
	var site := CitySystem.find_site(c, type, 6)
	if site.is_empty():
		return false
	var d: Dictionary = GameData.buildings[type]
	var road_cost: Dictionary = GameData.buildings["road"]["cost"]
	var total: Dictionary = d["cost"].duplicate()
	var roads: Array = site["road"]
	for r in road_cost.keys():
		total[r] = float(total.get(r, 0.0)) + float(road_cost[r]) * roads.size()
	var reserve := plan("min_treasury_reserve")
	if n.treasury - float(total.get("money", 0.0)) < reserve:
		return false
	var p: Province = state.provinces[c.province_id]
	if not EconomySystem.check_cost(n, [p], total)["ok"]:
		return false
	for cell in roads:
		Commands.build(state, n.id, c.id, "road", cell.x, cell.y, 0)
	var res := Commands.build(state, n.id, c.id, type, site["x"], site["y"], site["rot"])
	if res["ok"]:
		log.append("建造%s（%d,%d）" % [d["name"], site["x"], site["y"]])
		return true
	return false


# ---------------------------------------------------------------- market

static func _market(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var cap: Province = ctx["capital"]
	if cap == null or cap.controller != n.id:
		return
	var bal: Dictionary = ctx["balance"]
	var storage := EconomySystem.storage_cap(state, cap)
	var at_war := state.is_at_war(n.id)
	n.market_orders = {}
	for r in GameData.RESOURCE_IDS:
		var stock := cap.get_stock(r)
		var keep := 30.0
		if r == "food":
			keep = 40.0
		if r == "arms":
			keep = 60.0 if at_war else 35.0
		if r in ["coal", "iron", "steel"]:
			keep = 25.0
		if stock > keep and (stock > storage * 0.6 or (n.treasury < 150.0 and r != "arms") or bal[r] > 3.0):
			var amt: float = min((stock - keep) * 0.5, 8.0)
			if amt >= 1.0:
				n.market_orders[r] = {"mode": "sell", "amount": amt}
	# buy critical shortages if the treasury allows
	var food_need: float = (ctx["city"].pop if ctx["city"] != null else 0.0) * GameData.balf("population.food_per_pop", 0.05) + ctx["army_need"]["food"]
	if cap.get_stock("food") < food_need * 1.5 and bal["food"] < 0.0 and n.treasury > 150.0:
		n.market_orders["food"] = {"mode": "buy", "amount": min(6.0, food_need)}
	if at_war and cap.get_stock("arms") < 15.0 and n.treasury > 300.0:
		n.market_orders["arms"] = {"mode": "buy", "amount": 4.0}
	var c: City = ctx["city"]
	if c != null and c.count_type("steel_mill", true) > 0 and n.treasury > 350.0:
		for r in ["coal", "iron"]:
			if cap.get_stock(r) < 4.0 and bal[r] < 0.0:
				n.market_orders[r] = {"mode": "buy", "amount": 3.0}
	if not n.market_orders.is_empty():
		var parts := []
		for r in n.market_orders.keys():
			parts.append(("卖" if n.market_orders[r]["mode"] == "sell" else "买") + GameData.res_name(r))
		log.append("市场：" + "、".join(parts))


# ---------------------------------------------------------------- diplomacy

static func _diplomacy(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var rival: String = ctx["rival"]
	if rival == "":
		return
	var war: Dictionary = ctx["war"]
	if not war.is_empty():
		_consider_peace(state, n, war, ctx, log)
		return
	# --- trade agreement
	var last_trade := int(n.ai_memory.get("last_trade_offer", -100))
	if not state.has_treaty("trade", n.id, rival) and state.turn - last_trade >= 12 and n.ai_memory.get("war_plan_target", "") != rival:
		if state.get_relation(n.id, rival) >= GameData.balf("diplomacy.trade_min_relation", -20) and pers(n, "commerce") >= 0.7:
			n.ai_memory["last_trade_offer"] = state.turn
			var r := Commands.propose_trade(state, n.id, rival)
			if r.get("accepted", false):
				log.append("与%s签订贸易协定" % state.nations[rival].short_name)
			elif r.get("pending", false):
				log.append("向%s提议贸易协定" % state.nations[rival].short_name)
	# --- peaceful claims on neutral land
	_consider_claims(state, n, ctx, log)
	# --- war declaration
	_consider_war(state, n, ctx, log)


static func _consider_claims(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var best := ""
	var best_u := -1e9
	for pid in state.province_order:
		var chk := DiplomacySystem.can_claim(state, n.id, pid)
		if not chk["ok"]:
			continue
		var p: Province = state.provinces[pid]
		var cost: float = chk["cost"]
		var value := WorldMapSystem.province_value(state, pid) * 10.0
		for r in p.rural_output.keys():
			value += float(p.rural_output[r]) * GameData.res_price(r) * 8.0
		var u := value * pers(n, "expansion") - cost
		# keep a healthy reserve after paying
		if n.treasury - cost < 250.0:
			continue
		# prefer conquest when our army can take it cheaply
		if _native_conquest_ratio(state, n, pid) >= 2.0 and pers(n, "aggression") >= 0.5:
			continue
		if u > best_u:
			best_u = u
			best = pid
	if best != "" and best_u > 0.0:
		var r := Commands.claim_province(state, n.id, best)
		if r["ok"]:
			log.append("和平并入" + state.provinces[best].name)


static func _native_conquest_ratio(state: GameState, n: Nation, pid: String) -> float:
	var natives := []
	for a: Army in state.armies_in(pid):
		if state.nations[a.nation].is_native:
			natives.append(a)
	var mine := _field_army(state, n.id)
	if mine == null:
		return 0.0
	return CombatSystem.estimate(state, [mine], natives, pid)["ratio"]


static func _consider_war(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var rival: String = ctx["rival"]
	var diff: Dictionary = GameData.ai["difficulty"].get(state.difficulty, {})
	if state.turn < int(diff.get("war_grace_weeks", 20)):
		return
	if state.has_treaty("truce", n.id, rival):
		return
	var relation_blocked := state.get_relation(n.id, rival) > GameData.balf("war.declare_war_max_relation", 30)
	var own: float = ctx["own_power"]
	var enemy: float = max(ctx["rival_power"], 1.0)
	var ratio := own / enemy
	var stock: Dictionary = ctx["stock"]
	var ready: bool = stock["arms"] >= 15.0 and n.treasury >= 150.0 and ctx["balance"]["food"] > -3.0 and n.war_exhaustion < 10.0
	if not ready:
		n.ai_memory["war_eval"] = {"turn": state.turn, "ratio": ratio, "ready": false}
		return
	# pick the most valuable reachable enemy province
	var goal := ""
	var goal_u := -1e9
	for pid in state.provinces_owned(rival):
		if not WorldMapSystem.borders_nation(state, pid, n.id):
			continue
		var defense: float = 1.0 + float(GameData.terrain_def(state.provinces[pid].terrain)["defense_bonus"]) + 0.15 * state.provinces[pid].fort
		var u: float = WorldMapSystem.province_value(state, pid) / defense
		if u > goal_u:
			goal_u = u
			goal = pid
	if goal == "":
		return
	var aggression := pers(n, "aggression") * float(diff.get("aggression_mult", 1.0))
	var utility := aggression * 25.0 * (ratio - pers(n, "war_ratio")) + goal_u * 0.3 - n.war_exhaustion
	utility -= max(0.0, state.get_relation(n.id, rival)) * 0.3
	n.ai_memory["war_eval"] = {"turn": state.turn, "ratio": ratio, "ready": true, "utility": utility, "goal": goal}
	if utility > 4.0 and relation_blocked:
		# a casus belli needs worse relations: end the trade agreement first
		n.ai_memory["war_plan_target"] = rival
		if state.has_treaty("trade", n.id, rival):
			Commands.cancel_trade(state, n.id, rival)
			log.append("为备战终止与%s的贸易协定" % state.nations[rival].short_name)
		return
	if utility > 4.0:
		var r := Commands.declare_war(state, n.id, rival, goal)
		if r["ok"]:
			n.ai_memory["war_plan_target"] = ""
			log.append("对%s宣战（兵力比 %.2f，目标 %s）" % [state.nations[rival].short_name, ratio, state.provinces[goal].name])
	elif utility > -6.0:
		n.ai_memory["war_plan_target"] = rival   # preparing: refuse trade, build up


static func _consider_peace(state: GameState, n: Nation, war: Dictionary, ctx: Dictionary, log: Array) -> void:
	var enemy := DiplomacySystem.other_side(war, n.id)
	var score := DiplomacySystem.score_for(war, n.id)
	var last := int(n.ai_memory.get("last_peace_offer", -100))
	if state.turn - last < 4:
		return
	var duration := state.turn - int(war["start"])
	if score >= 20.0:
		var terms := _best_demands(state, n.id, enemy, war, score)
		if not terms.is_empty():
			n.ai_memory["last_peace_offer"] = state.turn
			var r := Commands.propose_peace(state, n.id, enemy, terms)
			log.append("以胜利者姿态提出和约" + ("（被接受）" if r.get("accepted", false) else ""))
			return
	var losing: bool = score <= -20.0 or n.war_exhaustion >= 30.0 or (duration > 40 and abs(score) < 10.0) or n.treasury < -100.0
	if losing:
		n.ai_memory["last_peace_offer"] = state.turn
		var r2 := Commands.propose_peace(state, n.id, enemy, {"type": "white"})
		log.append("提出白色和平" + ("（被接受）" if r2.get("accepted", false) else ""))


static func _best_demands(state: GameState, nid: String, enemy: String, war: Dictionary, score: float) -> Dictionary:
	var provs := []
	var budget := score
	var cands := []
	for pid in state.provinces_owned(enemy):
		var p: Province = state.provinces[pid]
		if p.controller == nid and state.nations[enemy].capital != pid:
			cands.append([WorldMapSystem.province_value(state, pid), pid])
	cands.sort()
	cands.reverse()
	for cnd in cands:
		var cost := DiplomacySystem.peace_cost_province(state, cnd[1])
		if cost <= budget:
			provs.append(cnd[1])
			budget -= cost
	var rep := int(floor(budget / GameData.balf("war.reparations_score_per_100", 4))) * 100
	rep = min(rep, 600)
	if provs.is_empty() and rep < 100:
		return {}
	return {"type": "demand", "provinces": provs, "reparations": rep}


# ---------------------------------------------------------------- military

static func _field_army(state: GameState, nid: String) -> Army:
	var best: Army = null
	for a: Army in state.armies_of(nid):
		if best == null or a.total_strength() > best.total_strength():
			best = a
	return best


static func _military(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	_recruit(state, n, ctx, log)
	# merge idle stacks that share a province
	for pid in state.province_order:
		var mine := []
		for a: Army in state.armies_in(pid, n.id):
			if a.path.is_empty():
				mine.append(a)
		if mine.size() > 1:
			Commands.merge_armies(state, n.id, pid)
	var war: Dictionary = ctx["war"]
	if not war.is_empty():
		_wartime_orders(state, n, ctx, war, log)
	else:
		_peacetime_orders(state, n, ctx, log)


static func _desired_regiments(state: GameState, n: Nation, ctx: Dictionary) -> float:
	var d := plan("army_target_base") * pers(n, "military")
	d += float(ctx["threat"]) / 4.0 * plan("army_target_per_threat")
	if state.is_at_war(n.id):
		d += 4.0
	if n.ai_memory.get("war_plan_target", "") != "":
		d += 3.0
	return d


static func _recruit(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var want := _desired_regiments(state, n, ctx)
	var have: float = ctx["regiments"]
	var cap: Province = ctx["capital"]
	if cap == null or cap.controller != n.id:
		return
	var reserve := plan("min_treasury_reserve") + 40.0
	var count := 0
	while have < want and count < 2:
		if ctx["net"] < 3.0 and not state.is_at_war(n.id):
			break
		var uid := _pick_unit(state, n, ctx)
		if uid == "":
			break
		var cost := MilitarySystem.recruit_cost(uid, 1)
		if n.treasury - float(cost["money"]) < reserve:
			break
		# keep arms for supplying the army in the field
		if float(ctx["stock"]["arms"]) - float(cost.get("arms", 0.0)) < float(ctx["army_need"]["arms"]) * 3.0:
			break
		var r := Commands.recruit(state, n.id, cap.id, uid, 1)
		if not r["ok"]:
			break
		ctx["stock"]["arms"] = float(ctx["stock"]["arms"]) - float(cost.get("arms", 0.0))
		ctx["net"] = float(ctx["net"]) - float(GameData.units[uid]["upkeep"])
		have += 1.0
		count += 1
		log.append("征召%s" % GameData.units[uid]["name"])


static func _pick_unit(state: GameState, n: Nation, ctx: Dictionary) -> String:
	var c: City = ctx["city"]
	var has_barracks := c != null and CitySystem.has_complete(c, "barracks")
	if not has_barracks:
		return "militia"
	var art := 0.0
	var tot := 0.0
	for a: Army in state.armies_of(n.id):
		art += float(a.units.get("artillery", 0.0))
		tot += a.total_strength()
	var stock: Dictionary = ctx["stock"]
	if (state.is_at_war(n.id) or pers(n, "aggression") >= 0.6) and art < tot * 0.25 and stock["steel"] >= 4.0 and stock["arms"] >= 12.0:
		return "artillery"
	if stock["arms"] >= 5.0:
		return "infantry"
	return "militia"


## Province of ours that borders the rival with the best defensive terrain.
static func _border_post(state: GameState, nid: String, rival: String) -> String:
	var best := ""
	var best_u := -1e9
	for pid in state.provinces_controlled(nid):
		if not WorldMapSystem.borders_nation(state, pid, rival):
			continue
		var p: Province = state.provinces[pid]
		var u := float(GameData.terrain_def(p.terrain)["defense_bonus"]) * 10.0 + p.fort * 3.0 + WorldMapSystem.province_value(state, pid) * 0.2
		if state.nations[nid].capital == pid:
			u += 6.0
		if u > best_u:
			best_u = u
			best = pid
	return best


static func _peacetime_orders(state: GameState, n: Nation, ctx: Dictionary, log: Array) -> void:
	var main := _field_army(state, n.id)
	if main == null:
		return
	# 1) conquer weak native neighbours with the field army
	if pers(n, "expansion") >= 0.6 and float(ctx["threat"]) < float(ctx["own_power"]) * 0.6:
		var best := ""
		var best_u := -1e9
		for pid in state.province_order:
			var p: Province = state.provinces[pid]
			if not state.nations[p.owner].is_native or not p.claim.is_empty():
				continue
			if not WorldMapSystem.borders_nation(state, pid, n.id):
				continue
			var natives := []
			for a: Army in state.armies_in(pid):
				if state.nations[a.nation].is_native:
					natives.append(a)
			var est := CombatSystem.estimate(state, [main], natives, pid)
			if float(est["ratio"]) < 2.0:
				continue
			var u := WorldMapSystem.province_value(state, pid) + float(est["ratio"])
			if u > best_u:
				best_u = u
				best = pid
		if best != "":
			if main.province != best and (main.path.is_empty() or main.path[-1] != best):
				var r := Commands.move_army(state, n.id, main.id, best)
				if r["ok"]:
					log.append("%s 出兵征服%s" % [main.name, state.provinces[best].name])
			return
	# 2) otherwise hold the strongest border position facing the rival
	var post := _border_post(state, n.id, ctx["rival"])
	if post == "":
		post = n.capital
	if main.province != post and main.path.is_empty() and state.provinces[main.province].controller == n.id:
		Commands.move_army(state, n.id, main.id, post)


static func _wartime_orders(state: GameState, n: Nation, ctx: Dictionary, war: Dictionary, log: Array) -> void:
	var enemy := DiplomacySystem.other_side(war, n.id)
	var cap: Province = ctx["capital"]
	var armies := state.armies_of(n.id)
	armies.sort_custom(func(a, b): return a.total_strength() > b.total_strength())
	for i in range(armies.size()):
		var a: Army = armies[i]
		# starving armies fall back toward the capital to regain supply
		if a.starving_weeks >= 2 and a.province != n.capital:
			var back := WorldMapSystem.find_path(state, n.id, a.province, n.capital)
			if not back.is_empty():
				Commands.move_army(state, n.id, a.id, back[0])
				log.append("%s 补给断绝，撤退" % a.name)
				continue
		# defend the capital when it is threatened. Secondary armies always
		# respond; the main army returns unless it is about to take the enemy
		# capital or the threat is minor compared with its own strength.
		if cap != null and cap.controller == n.id:
			var threat_cap := MilitarySystem.power_in(state, cap.id, enemy) * 2.0
			for nb in WorldMapSystem.neighbors(state, cap.id):
				threat_cap += MilitarySystem.power_in(state, nb, enemy)
			var own_pw := MilitarySystem.army_power(state, a)
			var near_win := false
			var ecap: Province = state.provinces.get(state.nations[enemy].capital)
			if ecap != null and a.province == ecap.id and not ecap.siege.is_empty() and float(ecap.siege["progress"]) > 50.0:
				near_win = true
			var must := threat_cap > 0.0 and (i > 0 or (threat_cap > own_pw * 0.4 and not near_win))
			if must and a.province != cap.id:
				var r := Commands.move_army(state, n.id, a.id, cap.id)
				if r["ok"]:
					log.append("%s 回援首都" % a.name)
					continue
			elif must:
				a.path = []
				continue
		_attack_or_defend(state, n, a, enemy, log)


static func _attack_or_defend(state: GameState, n: Nation, a: Army, enemy: String, log: Array) -> void:
	# sieging something worthwhile already? keep at it unless relief arrives
	var here: Province = state.provinces[a.province]
	if here.controller == enemy and state.armies_in(a.province, enemy).is_empty():
		var relief := 0.0
		for nb in WorldMapSystem.neighbors(state, a.province):
			relief += MilitarySystem.power_in(state, nb, enemy)
		if relief < MilitarySystem.army_power(state, a) * 1.2:
			a.path = []
			return
	var best := ""
	var best_u := -1e9
	var supply_need := a.weekly_need()
	for pid in state.province_order:
		var p: Province = state.provinces[pid]
		if p.controller != enemy:
			continue
		var path := WorldMapSystem.find_path(state, n.id, a.province, pid)
		if path.is_empty() or path.size() > 4:
			continue
		var defenders := state.armies_in(pid, enemy)
		var est := CombatSystem.estimate(state, [a], defenders, pid)
		var ratio := float(est["ratio"])
		if ratio < plan("attack_min_ratio"):
			continue
		var value := WorldMapSystem.province_value(state, pid)
		if pid == state.nations[enemy].capital:
			value *= 1.5
		# can our logistics keep the army fed out there?
		var feed := 99.0
		for nb in WorldMapSystem.neighbors(state, pid):
			if state.provinces[nb].controller == n.id:
				feed = min(feed, 99.0)
				feed = LogisticsSystem.route_capacity(state, n.id, n.capital, nb) if nb != n.capital else 99.0
				break
		var supply_pen := 0.0 if feed >= supply_need["food"] + supply_need["arms"] else 8.0
		var u: float = value * min(ratio, 2.5) - path.size() * 3.0 - supply_pen
		if u > best_u:
			best_u = u
			best = pid
	if best != "":
		if a.path.is_empty() or a.path[-1] != best:
			var r := Commands.move_army(state, n.id, a.id, best)
			if r["ok"]:
				log.append("%s 进攻%s" % [a.name, state.provinces[best].name])
		return
	# no good attack: defend the most threatened own province
	var target := ""
	var worst := 0.0
	for pid in state.provinces_controlled(n.id):
		var t := 0.0
		for nb in WorldMapSystem.neighbors(state, pid):
			t += MilitarySystem.power_in(state, nb, enemy)
		t += MilitarySystem.power_in(state, pid, enemy) * 2.0
		if state.nations[n.id].capital == pid:
			t *= 1.5
		if t > worst:
			worst = t
			target = pid
	# liberate our own occupied land if we can win there
	for pid in state.provinces_owned(n.id):
		var p2: Province = state.provinces[pid]
		if p2.controller == enemy:
			var est2 := CombatSystem.estimate(state, [a], state.armies_in(pid, enemy), pid)
			if float(est2["ratio"]) >= 1.1:
				target = pid
				break
	if target == "":
		target = _border_post(state, n.id, enemy)
	if target != "" and target != a.province and (a.path.is_empty() or a.path[-1] != target):
		Commands.move_army(state, n.id, a.id, target)
