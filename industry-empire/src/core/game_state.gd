class_name GameState
extends RefCounted
## The complete, serializable world state. Simulation systems are stateless
## functions operating on this object; the UI only reads it and issues commands.

const SAVE_VERSION := 1
const GAME_VERSION := "0.1.0"
const MAX_EVENTS := 300
const MAX_REPORTS := 40

var scenario_id := ""
var world_seed := 0
var rng := RandomNumberGenerator.new()
var turn := 0
var player_nation := ""
var difficulty := "normal"
var nations := {}            # id -> Nation
var nation_order: Array = []
var provinces := {}          # id -> Province
var province_order: Array = []
var edges: Array = []        # [{"a","b","capacity"}]
var cities := {}             # id -> City
var armies := {}             # int id -> Army
var next_army_id := 1
var wars: Array = []         # [{id, attacker, defender, goal, start, battle_score, score, battles}]
var next_war_id := 1
var treaties: Array = []     # [{type, a, b, start, end, per_week, weeks_left}]
var relations := {}          # "a|b" -> float
var proposals: Array = []    # pending AI -> player proposals
var next_proposal_id := 1
var events: Array = []
var battle_reports: Array = []
var transport_log := {}      # nation -> [shipments] of the last week
var world_ledger := {}       # reason -> {res: amount}; every stock change is recorded here
var game_over := {}          # {} while running, else {winner, loser, type, reason, turn}
# derived
var adjacency := {}          # id -> [ids]
var edge_index := {}         # "a|b" -> edge dict
var tech_cache := {}


# ---------------------------------------------------------------- creation

static func new_game(player: String, game_seed: int, difficulty_id := "normal", scenario_id_ := "mvp_two_crowns") -> GameState:
	GameData.ensure_loaded()
	var s := GameState.new()
	ScenarioLoader.build(s, GameData.scenario(scenario_id_), player, game_seed, difficulty_id)
	return s


func rebuild_derived() -> void:
	adjacency = {}
	edge_index = {}
	for pid in province_order:
		adjacency[pid] = []
	for e in edges:
		adjacency[e["a"]].append(e["b"])
		adjacency[e["b"]].append(e["a"])
		edge_index[edge_key(e["a"], e["b"])] = e
	for pid in province_order:
		adjacency[pid].sort()
	tech_cache = {}
	for c: City in cities.values():
		CitySystem.rebuild_occupancy(c)
		c.dirty = true
		CitySystem.refresh_connectivity(c)


# ---------------------------------------------------------------- queries

static func edge_key(a: String, b: String) -> String:
	return a + "|" + b if a < b else b + "|" + a


static func pair_key(a: String, b: String) -> String:
	return a + "|" + b if a < b else b + "|" + a


func nation(nid: String) -> Nation:
	return nations.get(nid)


func province(pid: String) -> Province:
	return provinces.get(pid)


func city_of(pid: String) -> City:
	var p: Province = provinces.get(pid)
	if p == null or p.city_id == "":
		return null
	return cities.get(p.city_id)


func province_of_city(c: City) -> Province:
	return provinces[c.province_id]


func active_nations() -> Array:
	var out := []
	for nid in nation_order:
		if nations[nid].is_active():
			out.append(nid)
	return out


func sorted_army_ids() -> Array:
	var ids := armies.keys()
	ids.sort()
	return ids


func armies_in(pid: String, nid := "") -> Array:
	var out := []
	for aid in sorted_army_ids():
		var a: Army = armies[aid]
		if a.province == pid and (nid == "" or a.nation == nid):
			out.append(a)
	return out


func armies_of(nid: String) -> Array:
	var out := []
	for aid in sorted_army_ids():
		if armies[aid].nation == nid:
			out.append(armies[aid])
	return out


func provinces_owned(nid: String) -> Array:
	var out := []
	for pid in province_order:
		if provinces[pid].owner == nid:
			out.append(pid)
	return out


func provinces_controlled(nid: String) -> Array:
	var out := []
	for pid in province_order:
		if provinces[pid].controller == nid:
			out.append(pid)
	return out


func get_relation(a: String, b: String) -> float:
	return float(relations.get(pair_key(a, b), 0.0))


func set_relation(a: String, b: String, v: float) -> void:
	relations[pair_key(a, b)] = clampf(v, -100.0, 100.0)


func find_war(a: String, b: String) -> Dictionary:
	for w in wars:
		if (w["attacker"] == a and w["defender"] == b) or (w["attacker"] == b and w["defender"] == a):
			return w
	return {}


func at_war(a: String, b: String) -> bool:
	return not find_war(a, b).is_empty()


func is_at_war(a: String) -> bool:
	for w in wars:
		if w["attacker"] == a or w["defender"] == a:
			return true
	return false


## Hostile = at war, or one side is the native pseudo-nation (natives defend their land).
func hostile(a: String, b: String) -> bool:
	if a == b:
		return false
	var na: Nation = nations.get(a)
	var nb: Nation = nations.get(b)
	if na == null or nb == null:
		return false
	if na.is_native or nb.is_native:
		return true
	return at_war(a, b)


func find_treaty(type: String, a: String, b: String) -> Dictionary:
	for t in treaties:
		if t["type"] == type and ((t["a"] == a and t["b"] == b) or (t["a"] == b and t["b"] == a)):
			return t
	return {}


func has_treaty(type: String, a: String, b: String) -> bool:
	return not find_treaty(type, a, b).is_empty()


func date_text(t := -1) -> String:
	if t < 0:
		t = turn
	var wpy := int(GameData.bal("calendar.weeks_per_year", 52))
	return "%d年 第%d周" % [int(GameData.bal("calendar.start_year", 1820)) + t / wpy, t % wpy + 1]


func log_event(type: String, text: String, nations_involved: Array = [], pid := "") -> void:
	events.append({"turn": turn, "type": type, "text": text, "nations": nations_involved, "province": pid})
	if events.size() > MAX_EVENTS:
		events = events.slice(events.size() - MAX_EVENTS)


func rand_range(lo: float, hi: float) -> float:
	return rng.randf_range(lo, hi)


# ---------------------------------------------------------------- ledger

func ledger_add(reason: String, res: String, amount: float) -> void:
	if not world_ledger.has(reason):
		world_ledger[reason] = {}
	world_ledger[reason][res] = float(world_ledger[reason].get(res, 0.0)) + amount


## Sum of all goods physically present in the world (province stocks + army supply).
func world_goods_total() -> Dictionary:
	var tot := {}
	for r in GameData.RESOURCE_IDS:
		tot[r] = 0.0
	for pid in province_order:
		for r in provinces[pid].stock.keys():
			tot[r] += float(provinces[pid].stock[r])
	for a: Army in armies.values():
		for r in a.supply.keys():
			tot[r] += float(a.supply[r])
	return tot


func world_ledger_total() -> Dictionary:
	var tot := {}
	for r in GameData.RESOURCE_IDS:
		tot[r] = 0.0
	for reason in world_ledger.keys():
		for r in world_ledger[reason].keys():
			tot[r] += float(world_ledger[reason][r])
	return tot


# ---------------------------------------------------------------- serialization

func to_dict() -> Dictionary:
	var nd := []
	for nid in nation_order:
		nd.append(nations[nid].to_dict())
	var pd := []
	for pid in province_order:
		pd.append(provinces[pid].to_dict())
	var cd := []
	var cids := cities.keys()
	cids.sort()
	for cid in cids:
		cd.append(cities[cid].to_dict())
	var ad := []
	for aid in sorted_army_ids():
		ad.append(armies[aid].to_dict())
	return {
		"save_version": SAVE_VERSION, "game_version": GAME_VERSION,
		"scenario_id": scenario_id, "seed": str(world_seed), "rng_seed": str(rng.seed), "rng_state": str(rng.state),
		"turn": turn, "player_nation": player_nation, "difficulty": difficulty,
		"nations": nd, "provinces": pd, "edges": edges.duplicate(true), "cities": cd, "armies": ad,
		"next_army_id": next_army_id, "wars": wars.duplicate(true), "next_war_id": next_war_id,
		"treaties": treaties.duplicate(true), "relations": relations.duplicate(),
		"proposals": proposals.duplicate(true), "next_proposal_id": next_proposal_id,
		"events": events.duplicate(true), "battle_reports": battle_reports.duplicate(true),
		"transport_log": transport_log.duplicate(true), "world_ledger": world_ledger.duplicate(true),
		"game_over": game_over.duplicate(true),
	}


static func from_dict(d: Dictionary) -> GameState:
	GameData.ensure_loaded()
	var s := GameState.new()
	s.scenario_id = d["scenario_id"]
	s.world_seed = int(d["seed"])
	s.rng.seed = int(d["rng_seed"])
	s.rng.state = int(d["rng_state"])
	s.turn = int(d["turn"])
	s.player_nation = d["player_nation"]
	s.difficulty = d.get("difficulty", "normal")
	for nd in d["nations"]:
		var n := Nation.from_dict(nd)
		s.nations[n.id] = n
		s.nation_order.append(n.id)
	for pd in d["provinces"]:
		var p := Province.from_dict(pd)
		s.provinces[p.id] = p
		s.province_order.append(p.id)
	for e in d["edges"]:
		s.edges.append({"a": e["a"], "b": e["b"], "capacity": float(e["capacity"])})
	for cd in d["cities"]:
		var c := City.from_dict(cd)
		s.cities[c.id] = c
	for ad in d["armies"]:
		var a := Army.from_dict(ad)
		s.armies[a.id] = a
	s.next_army_id = int(d["next_army_id"])
	for w in d["wars"]:
		s.wars.append({
			"id": int(w["id"]), "attacker": w["attacker"], "defender": w["defender"], "goal": w["goal"],
			"start": int(w["start"]), "battle_score": float(w["battle_score"]), "score": float(w["score"]),
			"battles": int(w["battles"]),
		})
	s.next_war_id = int(d["next_war_id"])
	for t in d["treaties"]:
		s.treaties.append({
			"type": t["type"], "a": t["a"], "b": t["b"], "start": int(t["start"]), "end": int(t["end"]),
			"per_week": float(t.get("per_week", 0.0)), "weeks_left": int(t.get("weeks_left", 0)),
		})
	s.relations = Ser.float_dict(d["relations"])
	s.proposals = d["proposals"]
	for pr in s.proposals:
		pr["id"] = int(pr["id"])
		pr["expires"] = int(pr["expires"])
	s.next_proposal_id = int(d["next_proposal_id"])
	s.events = d["events"]
	for e in s.events:
		e["turn"] = int(e["turn"])
	s.battle_reports = d["battle_reports"]
	s.transport_log = d["transport_log"]
	s.world_ledger = Ser.nested_float_dict(d["world_ledger"])
	s.game_over = d["game_over"]
	s.rebuild_derived()
	return s


## Canonical JSON of the full state; equal strings => identical worlds.
func fingerprint() -> String:
	return Ser.canonical_json(to_dict())
