class_name WorldMapSystem
extends RefCounted
## Province graph queries: movement rules and path finding.


static func neighbors(state: GameState, pid: String) -> Array:
	return state.adjacency.get(pid, [])


static func are_adjacent(state: GameState, a: String, b: String) -> bool:
	return state.edge_index.has(GameState.edge_key(a, b))


static func edge(state: GameState, a: String, b: String) -> Dictionary:
	return state.edge_index.get(GameState.edge_key(a, b), {})


static func move_cost(state: GameState, pid: String) -> float:
	return float(GameData.terrain_def(state.provinces[pid].terrain)["move_cost"])


## Can an army of `nid` enter province `pid`? Own/controlled land, land of a
## nation it is at war with, or native land. No military access otherwise.
static func can_enter(state: GameState, nid: String, pid: String) -> bool:
	var p: Province = state.provinces[pid]
	if p.controller == nid or p.owner == nid:
		return true
	if state.hostile(nid, p.controller) or state.hostile(nid, p.owner):
		return true
	return false


## Dijkstra over enterable provinces weighted by terrain move cost.
## Returns the list of provinces after `from` up to and including `to`, or [].
static func find_path(state: GameState, nid: String, from: String, to: String) -> Array:
	if from == to:
		return []
	if not state.provinces.has(to) or not can_enter(state, nid, to):
		return []
	var dist := {from: 0.0}
	var prev := {}
	var open := [from]
	var done := {}
	while not open.is_empty():
		var best_i := 0
		for i in range(1, open.size()):
			var a: String = open[i]
			var b: String = open[best_i]
			if dist[a] < dist[b] or (is_equal_approx(dist[a], dist[b]) and a < b):
				best_i = i
		var cur: String = open[best_i]
		open.remove_at(best_i)
		if done.has(cur):
			continue
		done[cur] = true
		if cur == to:
			break
		for nb in neighbors(state, cur):
			if done.has(nb) or not can_enter(state, nid, nb):
				continue
			var nd: float = dist[cur] + move_cost(state, nb)
			if not dist.has(nb) or nd < dist[nb] - 0.0001:
				dist[nb] = nd
				prev[nb] = cur
				if not open.has(nb):
					open.append(nb)
	if not prev.has(to):
		return []
	var path := []
	var c := to
	while c != from:
		path.push_front(c)
		c = prev[c]
	return path


## Hop distances from `from` over all provinces (ignores ownership).
static func hop_distances(state: GameState, from: String) -> Dictionary:
	var d := {from: 0}
	var q := [from]
	var head := 0
	while head < q.size():
		var cur: String = q[head]
		head += 1
		for nb in neighbors(state, cur):
			if not d.has(nb):
				d[nb] = int(d[cur]) + 1
				q.append(nb)
	return d


static func borders_nation(state: GameState, pid: String, other: String) -> bool:
	for nb in neighbors(state, pid):
		if state.provinces[nb].controller == other:
			return true
	return false


static func province_value(state: GameState, pid: String) -> float:
	var p: Province = state.provinces[pid]
	var v := GameData.balf("war.province_value_base", 10) + GameData.balf("war.province_value_per_dev", 2) * p.development
	var owner: Nation = state.nations[p.owner]
	if owner.capital == pid:
		v *= GameData.balf("war.capital_value_mult", 2.0)
	return v
