class_name EconomySystem
extends RefCounted
## Money, stockpiles, labour, production chains, population and finance.
## Every change to a stockpile goes through add_stock/remove_stock so the
## world ledger can prove that no goods appear from nowhere.

const EPS := 0.000001


# ---------------------------------------------------------------- money

static func earn(n: Nation, amount: float, category: String) -> void:
	if amount <= 0.0:
		return
	n.treasury += amount
	var inc: Dictionary = n.finance_pending["income"]
	inc[category] = float(inc.get(category, 0.0)) + amount


static func spend(n: Nation, amount: float, category: String) -> void:
	if amount <= 0.0:
		return
	n.treasury -= amount
	var ex: Dictionary = n.finance_pending["expense"]
	ex[category] = float(ex.get(category, 0.0)) + amount


# ---------------------------------------------------------------- stockpiles

static func storage_cap(state: GameState, p: Province) -> float:
	var base := GameData.balf("storage.rural_base", 50.0)
	var c := state.city_of(p.id)
	if c != null:
		base = GameData.balf("storage.city_base", 80.0) + CitySystem.warehouse_storage(c)
	return base * (1.0 + TechnologySystem.mod(state, p.controller, "storage_mult"))


static func space_for(state: GameState, p: Province, res: String) -> float:
	return max(0.0, storage_cap(state, p) - p.get_stock(res))


static func _record(state: GameState, nid: String, reason: String, res: String, amount: float) -> void:
	state.ledger_add(reason, res, amount)
	var n: Nation = state.nations.get(nid)
	if n == null:
		return
	for book in [n.week_ledger, n.ledger]:
		if not book.has(reason):
			book[reason] = {}
		book[reason][res] = float(book[reason].get(res, 0.0)) + amount


## Adds up to `amount` (clipped to free storage). Returns what was added.
static func add_stock(state: GameState, p: Province, res: String, amount: float, reason: String) -> float:
	if amount <= EPS:
		return 0.0
	var added: float = min(amount, space_for(state, p, res))
	if added <= 0.0:
		return 0.0
	p.stock[res] = p.get_stock(res) + added
	_record(state, p.controller, reason, res, added)
	return added


## Removes up to `amount` (never below zero). Returns what was removed.
static func remove_stock(state: GameState, p: Province, res: String, amount: float, reason: String) -> float:
	if amount <= EPS:
		return 0.0
	var removed: float = min(amount, p.get_stock(res))
	if removed <= 0.0:
		return 0.0
	p.stock[res] = max(0.0, p.get_stock(res) - removed)
	_record(state, p.controller, reason, res, -removed)
	return removed


## Moves goods between provinces, limited by source stock and target space.
static func transfer(state: GameState, from_p: Province, to_p: Province, res: String, amount: float, reason_out: String, reason_in: String) -> float:
	var amt: float = min(amount, from_p.get_stock(res), space_for(state, to_p, res))
	if amt <= EPS:
		return 0.0
	remove_stock(state, from_p, res, amt, reason_out)
	add_stock(state, to_p, res, amt, reason_in)
	return amt


## Checks a cost dictionary against treasury + the given province stockpiles.
static func check_cost(n: Nation, provinces: Array, cost: Dictionary) -> Dictionary:
	var missing := []
	if float(cost.get("money", 0.0)) > n.treasury + EPS:
		missing.append("金钱")
	for r in cost.keys():
		if r == "money":
			continue
		var have := 0.0
		for p: Province in provinces:
			have += p.get_stock(r)
		if have + EPS < float(cost[r]):
			missing.append(GameData.res_name(r))
	return {"ok": missing.is_empty(), "missing": missing}


static func pay_cost(state: GameState, n: Nation, provinces: Array, cost: Dictionary, category: String, reason: String) -> void:
	spend(n, float(cost.get("money", 0.0)), category)
	for r in cost.keys():
		if r == "money":
			continue
		var left := float(cost[r])
		for p: Province in provinces:
			if left <= EPS:
				break
			left -= remove_stock(state, p, r, left, reason)


# ---------------------------------------------------------------- setup

static func initialize(state: GameState) -> void:
	for cid in _city_ids(state):
		var c: City = state.cities[cid]
		CitySystem.refresh_connectivity(c)
		allocate_labor(state, c)
		_preview_city(state, c)


static func _city_ids(state: GameState) -> Array:
	var ids := state.cities.keys()
	ids.sort()
	return ids


# ---------------------------------------------------------------- labour

static func labor_total(c: City) -> int:
	return int(floor(c.pop * GameData.balf("population.labor_ratio", 0.5)))


static func allocate_labor(state: GameState, c: City) -> void:
	CitySystem.refresh_connectivity(c)
	var pool := labor_total(c)
	var total := pool
	var order := []
	for bid in c.sorted_ids():
		var b: Building = c.buildings[bid]
		b.workers = 0
		var d: Dictionary = b.def()
		if d["workers"] <= 0 or not b.is_complete() or not b.enabled:
			continue
		if d.get("needs_connection", false) and not c.connected.get(bid, false):
			continue
		order.append([d["priority"], bid])
	order.sort()
	var demand := 0
	for o in order:
		var b2: Building = c.buildings[o[1]]
		var want: int = b2.def()["workers"]
		demand += want
		var give: int = min(want, pool)
		b2.workers = give
		pool -= give
	c.stats["labor_total"] = total
	c.stats["labor_used"] = total - pool
	c.stats["labor_demand"] = demand


# ---------------------------------------------------------------- production

static func run_production(state: GameState) -> void:
	for pid in state.province_order:
		_rural_production(state, state.provinces[pid])
	for cid in _city_ids(state):
		produce_city(state, state.cities[cid])


static func _rural_production(state: GameState, p: Province) -> void:
	p.last_output = {}
	if p.rural_output.is_empty() or p.base_pop <= 0.0:
		return
	var factor := (p.pop / p.base_pop) * (1.0 - p.damage) * (0.5 + 0.5 * p.stability / 100.0)
	if p.is_occupied():
		factor *= GameData.balf("military.occupied_output_factor", 0.5)
	for r in p.rural_output.keys():
		var amt := float(p.rural_output[r]) * factor
		p.last_output[r] = add_stock(state, p, r, amt, "rural")


static func _base_scale(state: GameState, c: City, b: Building, n: Nation, p: Province) -> float:
	var d: Dictionary = b.def()
	var labor_f := 1.0
	if d["workers"] > 0:
		labor_f = float(b.workers) / float(d["workers"])
	var scale := labor_f * CitySystem.site_factor(c, b) * (1.0 - b.damage)
	scale *= 1.0 + TechnologySystem.mod(state, n.id, "throughput_mult", d.get("category", ""))
	if p.is_occupied():
		scale *= GameData.balf("military.occupied_output_factor", 0.5)
	if n.treasury < 0.0:
		scale *= 1.0 - GameData.balf("bankruptcy.efficiency_penalty", 0.2)
	if n.is_ai:
		scale *= float(GameData.ai["difficulty"].get(state.difficulty, {}).get("ai_output_mult", 1.0))
	return scale


static func input_need(state: GameState, nid: String, b: Building, scale: float) -> Dictionary:
	var d: Dictionary = b.def()
	var out := {}
	for r in d["inputs"].keys():
		out[r] = float(d["inputs"][r]) * max(0.0, 1.0 + TechnologySystem.mod(state, nid, "input_mult", b.type, r)) * scale
	return out


static func output_amount(state: GameState, nid: String, b: Building, scale: float) -> Dictionary:
	var d: Dictionary = b.def()
	var out := {}
	var mult := 1.0 + TechnologySystem.mod(state, nid, "output_mult", b.type)
	for r in d["outputs"].keys():
		out[r] = float(d["outputs"][r]) * mult * scale
	return out


static func produce_city(state: GameState, c: City) -> void:
	var p: Province = state.provinces[c.province_id]
	var n: Nation = state.nations[p.controller]
	CitySystem.refresh_connectivity(c)
	allocate_labor(state, c)
	var produced := {}
	var consumed := {}
	var cap := storage_cap(state, p)
	for stage in [0, 1, 2]:
		for bid in c.sorted_ids():
			var b: Building = c.buildings[bid]
			var d: Dictionary = b.def()
			if d["stage"] != stage:
				continue
			_produce_building(state, c, b, n, p, cap, produced, consumed)
	for bid in c.sorted_ids():
		var b2: Building = c.buildings[bid]
		if b2.def()["stage"] < 0:
			b2.last_in = {}
			b2.last_out = {}
			if not b2.is_complete():
				b2.status = "施工中（剩余%d周）" % b2.build_left
			elif b2.def().get("needs_connection", false) and not c.connected.get(bid, false):
				b2.status = "未连通仓库"
			else:
				b2.status = "正常"
	c.stats["produced"] = produced
	c.stats["consumed"] = consumed


static func _produce_building(state: GameState, c: City, b: Building, n: Nation, p: Province, cap: float, produced: Dictionary, consumed: Dictionary) -> void:
	var d: Dictionary = b.def()
	b.last_in = {}
	b.last_out = {}
	b.activity = 0.0
	if not b.is_complete():
		b.status = "施工中（剩余%d周）" % b.build_left
		return
	if not b.enabled:
		b.status = "已停用"
		return
	if d.get("needs_connection", false) and not c.connected.get(b.id, false):
		b.status = "未连通仓库，停产"
		return
	if d["workers"] > 0 and b.workers <= 0:
		b.status = "无工人"
		return
	var scale := _base_scale(state, c, b, n, p)
	var need := input_need(state, n.id, b, scale)
	var outs := output_amount(state, n.id, b, scale)
	var ratio := 1.0
	var limit := ""
	for r in need.keys():
		if need[r] > EPS:
			var rr: float = p.get_stock(r) / need[r]
			if rr < ratio:
				ratio = rr
				limit = r
	for r in outs.keys():
		var space: float = max(0.0, cap - p.get_stock(r))
		if outs[r] * ratio > space + EPS:
			ratio = space / outs[r] if outs[r] > EPS else 0.0
			limit = "storage"
	ratio = clampf(ratio, 0.0, 1.0)
	for r in need.keys():
		var used := remove_stock(state, p, r, need[r] * ratio, "input")
		b.last_in[r] = used
		consumed[r] = float(consumed.get(r, 0.0)) + used
	for r in outs.keys():
		var made := add_stock(state, p, r, outs[r] * ratio, "production")
		b.last_out[r] = made
		produced[r] = float(produced.get(r, 0.0)) + made
	var labor_f := 1.0 if d["workers"] <= 0 else float(b.workers) / float(d["workers"])
	b.activity = ratio * labor_f
	if ratio < 0.999:
		if limit == "storage":
			b.status = "仓库已满，减产"
		else:
			b.status = "缺少%s，减产" % GameData.res_name(limit)
	elif labor_f < 0.999:
		b.status = "劳动力不足（%d/%d）" % [b.workers, d["workers"]]
	elif b.damage > 0.01:
		b.status = "战争受损（%d%%）" % int(b.damage * 100)
	elif p.is_occupied():
		b.status = "被占领，减产"
	else:
		b.status = "正常运转"


## Estimates (without changing anything) each building's nominal weekly
## inputs/outputs so the UI shows numbers before the first week passes.
static func _preview_city(state: GameState, c: City) -> void:
	var p: Province = state.provinces[c.province_id]
	var n: Nation = state.nations[p.controller]
	var produced := {}
	var consumed := {}
	for bid in c.sorted_ids():
		var b: Building = c.buildings[bid]
		if b.def()["stage"] < 0:
			b.status = "正常"
			continue
		if not b.is_complete():
			b.status = "施工中（剩余%d周）" % b.build_left
			continue
		if b.def().get("needs_connection", false) and not c.connected.get(bid, false):
			b.status = "未连通仓库，停产"
			continue
		var scale := _base_scale(state, c, b, n, p)
		b.last_in = input_need(state, n.id, b, scale)
		b.last_out = output_amount(state, n.id, b, scale)
		for r in b.last_in.keys():
			consumed[r] = float(consumed.get(r, 0.0)) + b.last_in[r]
		for r in b.last_out.keys():
			produced[r] = float(produced.get(r, 0.0)) + b.last_out[r]
		b.status = "正常运转"
	c.stats["produced"] = produced
	c.stats["consumed"] = consumed
	c.stats["food_need"] = c.pop * GameData.balf("population.food_per_pop", 0.05)
	c.stats["food_got"] = c.stats["food_need"]
	c.stats["housing"] = CitySystem.housing_capacity(c)
	c.stats["growth"] = 0.0


# ---------------------------------------------------------------- construction

static func advance_construction(state: GameState) -> void:
	for cid in _city_ids(state):
		var c: City = state.cities[cid]
		var p: Province = state.provinces[c.province_id]
		var paused := p.is_occupied()
		for bid in c.sorted_ids():
			var b: Building = c.buildings[bid]
			if b.build_left > 0 and not paused:
				b.build_left -= 1
				if b.build_left == 0:
					c.dirty = true
					if not state.nations[p.owner].is_ai:
						state.log_event("build", "%s：%s 竣工" % [c.name, b.def()["name"]], [p.owner], p.id)
			elif b.damage > 0.0 and not paused:
				b.damage = max(0.0, b.damage - GameData.balf("construction.repair_per_week", 0.05))
		# undo is only possible within the week a building was placed
		c.undo_stack = []


# ---------------------------------------------------------------- population

static func run_population(state: GameState) -> void:
	var fpp := GameData.balf("population.food_per_pop", 0.05)
	for cid in _city_ids(state):
		var c: City = state.cities[cid]
		var p: Province = state.provinces[c.province_id]
		var n: Nation = state.nations[p.owner]
		var cap := CitySystem.housing_capacity(c)
		var need := c.pop * fpp
		var got := remove_stock(state, p, "food", need, "pop_consumption")
		var ratio := 1.0 if need <= EPS else got / need
		var old := c.pop
		if ratio < 0.999:
			c.pop -= c.pop * GameData.balf("population.starvation_rate", 0.05) * (1.0 - ratio)
		if c.pop > cap:
			var leave: float = max(1.0, (c.pop - cap) * GameData.balf("population.homeless_leave_rate", 0.1))
			c.pop = max(cap, c.pop - leave)
		elif ratio >= 0.999 and c.satisfaction >= GameData.balf("population.growth_min_satisfaction", 40):
			var grow: float = max(GameData.balf("population.min_growth", 2), c.pop * GameData.balf("population.growth_rate", 0.03))
			c.pop = min(cap, c.pop + grow)
		c.pop = max(GameData.balf("population.min_pop", 20), c.pop)
		var target := GameData.balf("population.satisfaction_base", 60)
		target += GameData.balf("population.satisfaction_food_weight", 30) * (ratio - 0.5) * 2.0
		target += float(GameData.bal("tax_policies." + n.tax_policy + ".satisfaction", 0))
		if state.is_at_war(p.owner):
			target += GameData.balf("population.satisfaction_war", -5)
		if p.is_occupied():
			target += GameData.balf("population.satisfaction_occupied", -20)
		if n.treasury < 0.0:
			target += GameData.balf("population.satisfaction_bankrupt", -15)
		target -= n.war_exhaustion * 0.5
		target = clampf(target, 0.0, 100.0)
		c.satisfaction = clampf(c.satisfaction + (target - c.satisfaction) * GameData.balf("population.satisfaction_adjust", 0.25), 0.0, 100.0)
		c.stats["food_need"] = need
		c.stats["food_got"] = got
		c.stats["housing"] = cap
		c.stats["growth"] = c.pop - old
	for pid in state.province_order:
		var pr: Province = state.provinces[pid]
		var cap2 := pr.base_pop * GameData.balf("population.rural_capacity_factor", 1.3)
		if not pr.is_occupied() and pr.stability >= 40.0 and cap2 > 0.0:
			pr.pop += pr.pop * GameData.balf("population.rural_growth_rate", 0.004) * (1.0 - pr.pop / cap2)
		elif pr.is_occupied():
			pr.pop -= pr.pop * 0.005
		pr.pop = max(GameData.balf("population.min_pop", 20), pr.pop)
		var st_target := 70.0
		var own: Nation = state.nations[pr.owner]
		if not own.is_native:
			st_target += float(GameData.bal("tax_policies." + own.tax_policy + ".satisfaction", 0)) * 0.5
			st_target -= own.war_exhaustion * 0.3
		if pr.is_occupied():
			st_target = 30.0
		pr.stability = clampf(pr.stability + (st_target - pr.stability) * 0.1, 0.0, 100.0)
		if not pr.is_occupied():
			pr.damage = max(0.0, pr.damage - 0.02)


# ---------------------------------------------------------------- finance

static func trade_agreements(state: GameState, nid: String) -> int:
	var cnt := 0
	for t in state.treaties:
		if t["type"] == "trade" and (t["a"] == nid or t["b"] == nid):
			cnt += 1
	return cnt


static func tax_estimate(state: GameState, nid: String) -> Dictionary:
	var n: Nation = state.nations[nid]
	var mult := float(GameData.bal("tax_policies." + n.tax_policy + ".mult", 1.0))
	mult *= 1.0 + GameData.balf("market.trade_agreement_tax_bonus", 0.05) * trade_agreements(state, nid)
	var occ_f := GameData.balf("military.occupied_tax_factor", 0.5)
	var city_tax := 0.0
	var rural_tax := 0.0
	for cid in _city_ids(state):
		var c: City = state.cities[cid]
		var p: Province = state.provinces[c.province_id]
		if p.controller != nid:
			continue
		var t := c.pop * GameData.balf("population.city_tax_per_pop", 0.15) * mult * (0.6 + 0.4 * c.satisfaction / 100.0)
		city_tax += t if p.owner == nid else t * occ_f
	for pid in state.province_order:
		var pr: Province = state.provinces[pid]
		if pr.controller != nid:
			continue
		var t2 := pr.pop * GameData.balf("population.rural_tax_per_pop", 0.025) * mult * (0.6 + 0.4 * pr.stability / 100.0)
		rural_tax += t2 if pr.owner == nid else t2 * occ_f
	return {"city": city_tax, "rural": rural_tax}


static func building_upkeep(state: GameState, nid: String) -> float:
	var total := 0.0
	for c: City in state.cities.values():
		if state.provinces[c.province_id].controller != nid:
			continue
		for b: Building in c.buildings.values():
			if b.is_complete():
				total += float(b.def()["upkeep"])
	return total


static func army_upkeep(state: GameState, nid: String) -> float:
	var total := 0.0
	for a: Army in state.armies_of(nid):
		for u in a.units.keys():
			total += float(a.units[u]) * float(GameData.units[u]["upkeep"])
	return total


static func run_finance(state: GameState) -> void:
	for nid in state.active_nations():
		var n: Nation = state.nations[nid]
		var tax := tax_estimate(state, nid)
		earn(n, tax["city"], "tax_city")
		earn(n, tax["rural"], "tax_rural")
		spend(n, building_upkeep(state, nid), "upkeep_buildings")
		spend(n, army_upkeep(state, nid), "upkeep_army")


## Closes the weekly books: finance report, ledgers and debt counter.
static func finalize_week(state: GameState) -> void:
	for nid in state.nation_order:
		var n: Nation = state.nations[nid]
		var inc := 0.0
		var outflow := 0.0
		for v in n.finance_pending["income"].values():
			inc += float(v)
		for v in n.finance_pending["expense"].values():
			outflow += float(v)
		n.finance = {"income": n.finance_pending["income"], "expense": n.finance_pending["expense"], "net": inc - outflow}
		n.finance_pending = {"income": {}, "expense": {}}
		n.finance_history.append(inc - outflow)
		if n.finance_history.size() > 26:
			n.finance_history = n.finance_history.slice(n.finance_history.size() - 26)
		n.last_week_ledger = n.week_ledger
		n.week_ledger = {}
		if n.is_active():
			if n.treasury < 0.0:
				n.debt_weeks += 1
				if n.debt_weeks == 1 or n.debt_weeks % 4 == 0:
					state.log_event("danger", "%s 国库赤字（%d），已持续 %d 周。" % [n.short_name, int(n.treasury), n.debt_weeks], [nid])
			else:
				n.debt_weeks = 0
			n.history.append({"turn": state.turn, "treasury": n.treasury, "industry": industry_index(state, nid),
				"pop": total_population(state, nid), "army": MilitarySystem.nation_power(state, nid)})
			if n.history.size() > 120:
				n.history = n.history.slice(n.history.size() - 120)


static func projected_net(state: GameState, nid: String) -> float:
	var n: Nation = state.nations[nid]
	var tax := tax_estimate(state, nid)
	return tax["city"] + tax["rural"] - building_upkeep(state, nid) - army_upkeep(state, nid) - TechnologySystem.funding_cost(n)


# ---------------------------------------------------------------- market & trade

static func market_capacity(state: GameState, nid: String) -> float:
	var n: Nation = state.nations[nid]
	var cap := GameData.balf("market.land_capacity", 4)
	var capital: Province = state.provinces.get(n.capital)
	if capital == null or capital.controller != nid:
		return 0.0
	for pid in state.provinces_controlled(nid):
		if state.provinces[pid].is_coastal() and state.provinces[pid].owner == nid:
			cap = GameData.balf("market.coastal_capacity", 12)
			break
	cap += GameData.balf("market.trade_agreement_capacity", 6) * trade_agreements(state, nid)
	return cap


static func run_market(state: GameState) -> void:
	for nid in state.active_nations():
		var n: Nation = state.nations[nid]
		var capital: Province = state.provinces.get(n.capital)
		var cap := market_capacity(state, nid)
		var used := 0.0
		var mlog := []
		if capital == null or cap <= 0.0:
			continue
		for r in GameData.RESOURCE_IDS:
			if not n.market_orders.has(r):
				continue
			var o: Dictionary = n.market_orders[r]
			var want := float(o["amount"])
			if want <= 0.0 or used >= cap:
				continue
			var price := GameData.res_price(r)
			if o["mode"] == "sell":
				var amt: float = min(want, cap - used, capital.get_stock(r))
				amt = remove_stock(state, capital, r, amt, "market_sell")
				if amt > EPS:
					earn(n, amt * price * GameData.balf("market.sell_ratio", 0.8), "trade_export")
					used += amt
					mlog.append({"res": r, "mode": "sell", "amount": amt})
			else:
				var unit := price * GameData.balf("market.buy_ratio", 1.3)
				var afford: float = max(0.0, n.treasury) / unit
				var amt2: float = min(want, cap - used, afford, space_for(state, capital, r))
				amt2 = add_stock(state, capital, r, amt2, "market_buy")
				if amt2 > EPS:
					spend(n, amt2 * unit, "trade_import")
					used += amt2
					mlog.append({"res": r, "mode": "buy", "amount": amt2})
		n.ai_memory["market_log"] = mlog
		n.ai_memory["market_used"] = used


# ---------------------------------------------------------------- indicators

static func industry_index(state: GameState, nid: String) -> float:
	var v := 0.0
	for c: City in state.cities.values():
		if state.provinces[c.province_id].controller != nid:
			continue
		var prod: Dictionary = c.stats.get("produced", {})
		for r in prod.keys():
			if GameData.resource_by_id[r].get("industrial", false):
				v += float(prod[r]) * GameData.res_price(r)
	return v


static func total_population(state: GameState, nid: String) -> float:
	var tot := 0.0
	for pid in state.province_order:
		var p: Province = state.provinces[pid]
		if p.owner == nid:
			tot += p.pop
			var c := state.city_of(pid)
			if c != null:
				tot += c.pop
	return tot


static func nation_stock(state: GameState, nid: String) -> Dictionary:
	var tot := {}
	for r in GameData.RESOURCE_IDS:
		tot[r] = 0.0
	for pid in state.provinces_controlled(nid):
		for r in GameData.RESOURCE_IDS:
			tot[r] += state.provinces[pid].get_stock(r)
	return tot


## Rough weekly production/consumption balance per resource (for UI and AI).
static func resource_balance(state: GameState, nid: String) -> Dictionary:
	var out := {}
	for r in GameData.RESOURCE_IDS:
		out[r] = {"prod": 0.0, "cons": 0.0}
	var lw: Dictionary = state.nations[nid].last_week_ledger
	for reason in ["production", "rural", "market_buy", "trade_in"]:
		for r in lw.get(reason, {}).keys():
			out[r]["prod"] += float(lw[reason][r])
	for reason in ["input", "pop_consumption", "construction", "recruit", "market_sell", "trade_out", "army_supply"]:
		for r in lw.get(reason, {}).keys():
			out[r]["cons"] -= float(lw[reason][r])
	return out
