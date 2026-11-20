class_name Commands
extends RefCounted
## The only way the player OR an AI may change the world between weeks.
## Every command validates its preconditions and pays real costs, so the AI
## cannot do anything the player cannot.


static func _err(reason: String) -> Dictionary:
	return {"ok": false, "reason": reason}


static func _running(state: GameState) -> bool:
	return state.game_over.is_empty()


static func _own_city(state: GameState, nid: String, city_id: String) -> Dictionary:
	var c: City = state.cities.get(city_id)
	if c == null:
		return _err("城市不存在")
	var p: Province = state.provinces[c.province_id]
	if p.owner != nid or p.controller != nid:
		return _err("只能管理本国控制的城市")
	return {"ok": true, "city": c, "province": p}


# ---------------------------------------------------------------- city

static func build(state: GameState, nid: String, city_id: String, type: String, x: int, y: int, rot := 0) -> Dictionary:
	if not _running(state):
		return _err("游戏已结束")
	var oc := _own_city(state, nid, city_id)
	if not oc["ok"]:
		return oc
	var c: City = oc["city"]
	var p: Province = oc["province"]
	if not GameData.buildings.has(type):
		return _err("未知建筑")
	var chk := CitySystem.can_place(c, type, x, y, rot)
	if not chk["ok"]:
		return chk
	var d: Dictionary = GameData.buildings[type]
	var n: Nation = state.nations[nid]
	var cc := EconomySystem.check_cost(n, [p], d["cost"])
	if not cc["ok"]:
		return _err("资源不足：" + "、".join(cc["missing"]))
	EconomySystem.pay_cost(state, n, [p], d["cost"], "construction", "construction")
	var b := CitySystem.place(c, type, x, y, rot, d["build_weeks"], state.turn, d["cost"])
	c.undo_stack.append({"turn": state.turn, "building_id": b.id})
	CitySystem.refresh_connectivity(c)
	EconomySystem.allocate_labor(state, c)
	return {"ok": true, "reason": "", "building_id": b.id}


## Builds a road on every valid cell of a dragged line; stops when money/stone run out.
static func build_roads(state: GameState, nid: String, city_id: String, cells: Array) -> Dictionary:
	var built := 0
	var last_err := ""
	for cell in cells:
		var r := build(state, nid, city_id, "road", cell.x, cell.y, 0)
		if r["ok"]:
			built += 1
		else:
			last_err = r["reason"]
	return {"ok": built > 0, "built": built, "reason": last_err}


static func demolish(state: GameState, nid: String, city_id: String, bid: int) -> Dictionary:
	if not _running(state):
		return _err("游戏已结束")
	var oc := _own_city(state, nid, city_id)
	if not oc["ok"]:
		return oc
	var c: City = oc["city"]
	var p: Province = oc["province"]
	var b: Building = c.buildings.get(bid)
	if b == null:
		return _err("建筑不存在")
	if b.def().get("hub", false) and c.count_type("warehouse", true) <= 1 and b.is_complete():
		return _err("城市至少需要一座仓库")
	var refund_ratio := GameData.balf("construction.demolish_refund", 0.5)
	var paid: Dictionary = b.paid if not b.paid.is_empty() else b.def()["cost"]
	for r in paid.keys():
		if r != "money":
			EconomySystem.add_stock(state, p, r, float(paid[r]) * refund_ratio, "refund")
	CitySystem.remove(c, bid)
	CitySystem.refresh_connectivity(c)
	EconomySystem.allocate_labor(state, c)
	return {"ok": true, "reason": ""}


## Reverts the most recent placement made this week, with a full refund.
static func undo_build(state: GameState, nid: String, city_id: String) -> Dictionary:
	var oc := _own_city(state, nid, city_id)
	if not oc["ok"]:
		return oc
	var c: City = oc["city"]
	var p: Province = oc["province"]
	var n: Nation = state.nations[nid]
	while not c.undo_stack.is_empty():
		var u: Dictionary = c.undo_stack.pop_back()
		var b: Building = c.buildings.get(int(u["building_id"]))
		if b == null or int(u["turn"]) != state.turn:
			continue
		for r in b.paid.keys():
			if r == "money":
				EconomySystem.earn(n, float(b.paid[r]), "refund")
			else:
				EconomySystem.add_stock(state, p, r, float(b.paid[r]), "refund")
		CitySystem.remove(c, b.id)
		CitySystem.refresh_connectivity(c)
		EconomySystem.allocate_labor(state, c)
		return {"ok": true, "reason": "", "type": b.type}
	return _err("本周没有可撤销的建造")


static func toggle_building(state: GameState, nid: String, city_id: String, bid: int) -> Dictionary:
	var oc := _own_city(state, nid, city_id)
	if not oc["ok"]:
		return oc
	var b: Building = oc["city"].buildings.get(bid)
	if b == null:
		return _err("建筑不存在")
	b.enabled = not b.enabled
	EconomySystem.allocate_labor(state, oc["city"])
	return {"ok": true, "reason": "", "enabled": b.enabled}


# ---------------------------------------------------------------- military

static func recruit(state: GameState, nid: String, pid: String, uid: String, count := 1) -> Dictionary:
	if not _running(state):
		return _err("游戏已结束")
	if not GameData.units.has(uid) or count < 1:
		return _err("无效的兵种")
	var chk := MilitarySystem.recruit_province_ok(state, nid, pid, uid)
	if not chk["ok"]:
		return chk
	var men := float(GameData.units[uid]["manpower"]) * count
	if MilitarySystem.manpower_available(state, nid) < men:
		return _err("可征召人口不足（需要%d，可用%d）" % [int(men), MilitarySystem.manpower_available(state, nid)])
	var n: Nation = state.nations[nid]
	var cost := MilitarySystem.recruit_cost(uid, count)
	var sources := MilitarySystem.recruit_sources(state, nid, pid)
	var cc := EconomySystem.check_cost(n, sources, cost)
	if not cc["ok"]:
		return _err("资源不足：" + "、".join(cc["missing"]))
	EconomySystem.pay_cost(state, n, sources, cost, "recruit", "recruit")
	MilitarySystem.draw_manpower(state, nid, men)
	var army: Army = null
	for a: Army in state.armies_in(pid, nid):
		if a.path.is_empty() and not a.in_battle:
			army = a
			break
	var morale := GameData.balf("military.recruit_morale", 0.5)
	var c := state.city_of(pid)
	if c != null and CitySystem.has_complete(c, "barracks"):
		morale = float(GameData.buildings["barracks"].get("recruit_morale", 0.8))
	if army == null:
		army = MilitarySystem.create_army(state, nid, pid, MilitarySystem.army_name(state, nid))
		army.arrived_turn = state.turn
	var old_s := army.total_strength()
	army.units[uid] = float(army.units.get(uid, 0.0)) + count
	var mm := MilitarySystem.max_morale(state, army)
	army.morale = (army.morale * old_s + min(morale, mm) * count) / (old_s + count)
	if not n.is_ai:
		state.log_event("military", "在%s征召了 %d 团%s。" % [state.provinces[pid].name, count, GameData.units[uid]["name"]], [nid], pid)
	return {"ok": true, "reason": "", "army_id": army.id}


static func _own_army(state: GameState, nid: String, aid: int) -> Army:
	var a: Army = state.armies.get(aid)
	if a == null or a.nation != nid:
		return null
	return a


static func move_army(state: GameState, nid: String, aid: int, target: String) -> Dictionary:
	if not _running(state):
		return _err("游戏已结束")
	var a := _own_army(state, nid, aid)
	if a == null:
		return _err("部队不存在")
	if target == a.province:
		a.path = []
		a.move_progress = 0.0
		return {"ok": true, "reason": "", "path": []}
	var path := WorldMapSystem.find_path(state, nid, a.province, target)
	if path.is_empty():
		return _err("无法到达：没有通行权或道路不通（和平时期不能进入他国领土）")
	if a.path.is_empty() or a.path[0] != path[0]:
		a.move_progress = 0.0
	a.path = path
	return {"ok": true, "reason": "", "path": path}


static func stop_army(state: GameState, nid: String, aid: int) -> Dictionary:
	var a := _own_army(state, nid, aid)
	if a == null:
		return _err("部队不存在")
	a.path = []
	a.move_progress = 0.0
	return {"ok": true, "reason": ""}


static func split_army(state: GameState, nid: String, aid: int) -> Dictionary:
	var a := _own_army(state, nid, aid)
	if a == null:
		return _err("部队不存在")
	if a.total_strength() < 2.0:
		return _err("兵力太少，无法拆分")
	var b := MilitarySystem.create_army(state, nid, a.province, MilitarySystem.army_name(state, nid))
	b.morale = a.morale
	b.arrived_turn = a.arrived_turn
	b.supply_ratio = a.supply_ratio.duplicate()
	for u in a.units.keys():
		var half := floorf(float(a.units[u]) / 2.0 * 10.0) / 10.0
		if half > 0.0:
			b.units[u] = half
			a.units[u] = float(a.units[u]) - half
	for r in a.supply.keys():
		var hs := float(a.supply[r]) / 2.0
		b.supply[r] = hs
		a.supply[r] = float(a.supply[r]) - hs
	return {"ok": true, "reason": "", "army_id": b.id}


static func merge_armies(state: GameState, nid: String, pid: String) -> Dictionary:
	var m := MilitarySystem.merge_armies_in(state, nid, pid)
	if m == null:
		return _err("该省没有本国部队")
	return {"ok": true, "reason": "", "army_id": m.id}


static func disband(state: GameState, nid: String, aid: int, uid: String, count: float) -> Dictionary:
	var a := _own_army(state, nid, aid)
	if a == null or not a.units.has(uid):
		return _err("部队不存在")
	var n: float = minf(count, float(a.units[uid]))
	a.units[uid] = float(a.units[uid]) - n
	# discharged soldiers return home
	var men: float = n * float(GameData.units[uid]["manpower"])
	var home: Province = state.provinces.get(state.nations[nid].capital)
	if home != null and home.owner == nid:
		home.pop += men
	MilitarySystem.cleanup(state)
	return {"ok": true, "reason": ""}


# ---------------------------------------------------------------- policy

static func set_tax(state: GameState, nid: String, policy: String) -> Dictionary:
	if not GameData.balance["tax_policies"].has(policy):
		return _err("无效税制")
	state.nations[nid].tax_policy = policy
	return {"ok": true, "reason": ""}


static func set_research_funding(state: GameState, nid: String, level: int) -> Dictionary:
	var levels: Array = GameData.bal("research.funding_levels", [0])
	if level < 0 or level >= levels.size():
		return _err("无效的科研投入等级")
	state.nations[nid].research_funding = level
	return {"ok": true, "reason": ""}


static func set_research(state: GameState, nid: String, tid: String) -> Dictionary:
	if not TechnologySystem.can_research(state, nid, tid):
		return _err("不满足研究条件")
	var n: Nation = state.nations[nid]
	n.research_target = tid
	TechnologySystem._apply_bank(state, n)
	return {"ok": true, "reason": ""}


static func set_market_order(state: GameState, nid: String, res: String, mode: String, amount: float) -> Dictionary:
	if not GameData.resource_by_id.has(res) or not (mode in ["sell", "buy", "none"]) or amount < 0.0:
		return _err("无效的贸易指令")
	var n: Nation = state.nations[nid]
	if mode == "none" or amount <= 0.0:
		n.market_orders.erase(res)
	else:
		n.market_orders[res] = {"mode": mode, "amount": amount}
	return {"ok": true, "reason": ""}


# ---------------------------------------------------------------- diplomacy

static func declare_war(state: GameState, nid: String, target: String, goal: String) -> Dictionary:
	if not _running(state):
		return _err("游戏已结束")
	return DiplomacySystem.declare_war(state, nid, target, goal)


static func propose_peace(state: GameState, nid: String, target: String, terms: Dictionary) -> Dictionary:
	return DiplomacySystem.propose_peace(state, nid, target, terms)


static func propose_trade(state: GameState, nid: String, target: String) -> Dictionary:
	return DiplomacySystem.propose_trade(state, nid, target)


static func cancel_trade(state: GameState, nid: String, target: String) -> Dictionary:
	return DiplomacySystem.cancel_trade(state, nid, target)


static func respond_proposal(state: GameState, nid: String, proposal_id: int, accept: bool) -> Dictionary:
	for pr in state.proposals:
		if int(pr["id"]) == proposal_id and pr["to"] != nid:
			return _err("不是发给你的提议")
	return DiplomacySystem.respond(state, proposal_id, accept)


static func claim_province(state: GameState, nid: String, pid: String) -> Dictionary:
	return DiplomacySystem.start_claim(state, nid, pid)
