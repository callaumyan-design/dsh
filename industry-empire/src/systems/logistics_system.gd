class_name LogisticsSystem
extends RefCounted
## Inter-province transport. Each week every nation routes goods along the
## province graph to satisfy demand in priority order:
##   0. city food   1. army supply   2. industrial inputs
##   3. construction reserve (wood/stone)   4. consolidation toward the capital
## Each edge has a weekly capacity shared by all of a nation's shipments.
## Goods only travel through provinces the nation controls that are not
## blockaded by a hostile army; the last hop may enter an army's province.

const EPS := 0.0001


static func edge_capacity(state: GameState, nid: String, e: Dictionary) -> float:
	return float(e["capacity"]) * (1.0 + TechnologySystem.mod(state, nid, "transport_mult"))


static func blockaded(state: GameState, nid: String, pid: String) -> bool:
	for a: Army in state.armies_in(pid):
		if state.hostile(nid, a.nation):
			return true
	return false


static func node_ok(state: GameState, nid: String, pid: String) -> bool:
	return state.provinces[pid].controller == nid and not blockaded(state, nid, pid)


static func run(state: GameState) -> void:
	state.transport_log = {}
	for nid in state.active_nations():
		state.transport_log[nid] = _run_nation(state, nid)


static func _run_nation(state: GameState, nid: String) -> Array:
	var n: Nation = state.nations[nid]
	var used := {}  # edge key -> used capacity
	var shipments := []
	var reserve := _reserves(state, nid)
	var requests := _requests(state, nid, reserve)
	for req in requests:
		_serve(state, nid, req, reserve, used, shipments)
	return shipments


## Local demand each province keeps for itself before exporting.
static func _reserves(state: GameState, nid: String) -> Dictionary:
	var out := {}
	for pid in state.provinces_controlled(nid):
		out[pid] = {}
		var c := state.city_of(pid)
		if c == null:
			continue
		var fpp := GameData.balf("population.food_per_pop", 0.05)
		out[pid]["food"] = c.pop * fpp * 2.0
		var inputs := city_input_demand(state, c)
		for r in inputs.keys():
			out[pid][r] = float(out[pid].get(r, 0.0)) + inputs[r] * 2.0
	return out


static func city_input_demand(state: GameState, c: City) -> Dictionary:
	var out := {}
	var p: Province = state.provinces[c.province_id]
	for bid in c.sorted_ids():
		var b: Building = c.buildings[bid]
		if not b.is_complete() or not b.enabled or b.def()["inputs"].is_empty():
			continue
		if not c.connected.get(bid, false):
			continue
		var need := EconomySystem.input_need(state, p.controller, b, 1.0)
		for r in need.keys():
			out[r] = float(out.get(r, 0.0)) + need[r]
	return out


static func _requests(state: GameState, nid: String, reserve: Dictionary) -> Array:
	var reqs := []
	var n: Nation = state.nations[nid]
	# 0. city food
	for pid in state.provinces_controlled(nid):
		var c := state.city_of(pid)
		if c == null:
			continue
		var p: Province = state.provinces[pid]
		var target := float(reserve[pid].get("food", 0.0))
		var deficit := target - p.get_stock("food")
		if deficit > EPS:
			reqs.append({"prio": 0, "res": "food", "dest": pid, "amount": deficit, "army": 0})
	# 1. army supply
	var buf := GameData.balf("logistics.army_buffer_weeks", 2.0)
	for a: Army in state.armies_of(nid):
		var need := a.weekly_need()
		for r in ["food", "arms"]:
			var deficit2: float = need[r] * buf - float(a.supply.get(r, 0.0))
			if deficit2 > EPS:
				reqs.append({"prio": 1, "res": r, "dest": a.province, "amount": deficit2, "army": a.id})
	# 2. industrial inputs
	for pid in state.provinces_controlled(nid):
		var c2 := state.city_of(pid)
		if c2 == null:
			continue
		var p2: Province = state.provinces[pid]
		var inputs := city_input_demand(state, c2)
		for r in GameData.RESOURCE_IDS:
			if not inputs.has(r):
				continue
			var deficit3: float = inputs[r] * 2.0 - p2.get_stock(r)
			if deficit3 > EPS:
				reqs.append({"prio": 2, "res": r, "dest": pid, "amount": deficit3, "army": 0})
	# 3. construction reserve in cities
	for pid in state.provinces_controlled(nid):
		if state.city_of(pid) == null:
			continue
		var p3: Province = state.provinces[pid]
		for r in ["wood", "stone"]:
			var deficit4: float = 40.0 - p3.get_stock(r)
			if deficit4 > EPS:
				reqs.append({"prio": 3, "res": r, "dest": pid, "amount": deficit4, "army": 0})
	# 4. consolidate everything else toward the capital (for markets & recruiting)
	var capital: Province = state.provinces.get(n.capital)
	if capital != null and capital.controller == nid:
		for r in GameData.RESOURCE_IDS:
			var space := EconomySystem.space_for(state, capital, r)
			if space > EPS:
				reqs.append({"prio": 4, "res": r, "dest": capital.id, "amount": space, "army": 0, "consolidate": true})
	return reqs


static func _surplus(state: GameState, pid: String, res: String, reserve: Dictionary) -> float:
	var p: Province = state.provinces[pid]
	return max(0.0, p.get_stock(res) - float(reserve.get(pid, {}).get(res, 0.0)))


static func _serve(state: GameState, nid: String, req: Dictionary, reserve: Dictionary, used: Dictionary, shipments: Array) -> void:
	var left: float = req["amount"]
	var res: String = req["res"]
	var dest: String = req["dest"]
	var army: Army = state.armies.get(req["army"]) if req["army"] != 0 else null
	var dest_p: Province = state.provinces[dest]
	# Army inside our own territory draws from the local stockpile first.
	if army != null and node_ok(state, nid, dest):
		var local: float = min(left, _surplus(state, dest, res, reserve))
		if local > EPS:
			var got := EconomySystem.remove_stock(state, dest_p, res, local, "army_supply")
			MilitarySystem.add_supply(state, army, res, got)
			left -= got
			shipments.append({"from": dest, "to": dest, "res": res, "amount": got, "army": army.id, "path": [dest]})
	if left <= EPS:
		return
	var sources := _sources_by_distance(state, nid, dest, army != null)
	for src in sources:
		if left <= EPS:
			break
		if src["pid"] == dest:
			continue
		var avail := _surplus(state, src["pid"], res, reserve)
		if req.get("consolidate", false):
			# only move what the source province does not need itself and if it is rural
			if state.city_of(src["pid"]) != null:
				continue
		if avail <= EPS:
			continue
		var path: Array = src["path"]
		var cap := 1e9
		for i in range(path.size() - 1):
			var e := WorldMapSystem.edge(state, path[i], path[i + 1])
			var key := GameState.edge_key(path[i], path[i + 1])
			cap = min(cap, edge_capacity(state, nid, e) - float(used.get(key, 0.0)))
		if cap <= EPS:
			continue
		var amt: float = min(left, avail, cap)
		var src_p: Province = state.provinces[src["pid"]]
		var moved := 0.0
		if army != null:
			moved = EconomySystem.remove_stock(state, src_p, res, amt, "army_supply")
			MilitarySystem.add_supply(state, army, res, moved)
		else:
			moved = EconomySystem.transfer(state, src_p, dest_p, res, amt, "transport_out", "transport_in")
		if moved <= EPS:
			continue
		for i in range(path.size() - 1):
			var key2 := GameState.edge_key(path[i], path[i + 1])
			used[key2] = float(used.get(key2, 0.0)) + moved
		left -= moved
		shipments.append({"from": src["pid"], "to": dest, "res": res, "amount": moved, "army": army.id if army else 0, "path": path})


## All provinces from which goods can reach `dest`, nearest first, with the
## path (source ... dest). Intermediate nodes must be controlled and not
## blockaded; for army supply the destination itself may be hostile.
static func _sources_by_distance(state: GameState, nid: String, dest: String, to_army: bool) -> Array:
	var dest_ok := node_ok(state, nid, dest)
	if not dest_ok and not to_army:
		return []
	var max_hops := int(GameData.bal("logistics.path_max_hops", 6))
	var prev := {dest: ""}
	var depth := {dest: 0}
	var q := [dest]
	var head := 0
	var out := []
	while head < q.size():
		var cur: String = q[head]
		head += 1
		if cur != dest:
			var path := [cur]
			var c: String = prev[cur]
			while c != "":
				path.append(c)
				c = prev[c]
			out.append({"pid": cur, "path": path})
		if int(depth[cur]) >= max_hops:
			continue
		for nb in WorldMapSystem.neighbors(state, cur):
			if prev.has(nb) or not node_ok(state, nid, nb):
				continue
			prev[nb] = cur
			depth[nb] = int(depth[cur]) + 1
			q.append(nb)
	return out


## Bottleneck capacity of the best route between two provinces for a nation
## (used by the UI to explain front-line supply limits).
static func route_capacity(state: GameState, nid: String, from: String, to: String) -> float:
	var best := {from: 1e9}
	var open := [from]
	while not open.is_empty():
		var cur: String = open.pop_front()
		for nb in WorldMapSystem.neighbors(state, cur):
			if nb != to and not node_ok(state, nid, nb):
				continue
			var c: float = min(best[cur], edge_capacity(state, nid, WorldMapSystem.edge(state, cur, nb)))
			if c > float(best.get(nb, 0.0)) + EPS:
				best[nb] = c
				if nb != to:
					open.append(nb)
	return float(best.get(to, 0.0)) if to != from else 1e9
