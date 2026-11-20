class_name TestCase
extends RefCounted
## Minimal test base: methods named test_* are run by tests/run_tests.gd.

var failures: Array = []
var checks := 0


func check(cond: bool, msg: String) -> void:
	checks += 1
	if not cond:
		failures.append(msg)


func check_eq(a, b, msg: String) -> void:
	checks += 1
	if a != b:
		failures.append("%s (got %s, expected %s)" % [msg, str(a), str(b)])


func check_near(a: float, b: float, eps: float, msg: String) -> void:
	checks += 1
	if absf(a - b) > eps:
		failures.append("%s (got %.6f, expected %.6f)" % [msg, a, b])


## Fresh game; by default both nations are AI-free for deterministic unit tests.
func new_state(seed_v := 7, player := "aster") -> GameState:
	GameData.ensure_loaded()
	return GameState.new_game(player, seed_v)


func all_ai(s: GameState) -> void:
	for nid in s.nation_order:
		s.nations[nid].is_ai = not s.nations[nid].is_native


## Turn off AI so a unit test fully controls the world.
func no_ai(s: GameState) -> void:
	for nid in s.nation_order:
		s.nations[nid].is_ai = false


func run_weeks(s: GameState, n: int) -> void:
	for i in range(n):
		if not s.game_over.is_empty():
			return
		var r := TurnSystem.advance(s)
		check(r["problems"].is_empty(), "invariants at week %d: %s" % [s.turn, str(r["problems"])])


## Empties a city province and gives exactly the given goods.
func set_stock(s: GameState, pid: String, goods: Dictionary) -> void:
	var p: Province = s.provinces[pid]
	for r in GameData.RESOURCE_IDS:
		p.stock[r] = float(goods.get(r, 0.0))


func find_free_spot(c: City, type: String) -> Vector2i:
	for y in range(c.height):
		for x in range(c.width):
			if CitySystem.can_place(c, type, x, y, 0)["ok"]:
				return Vector2i(x, y)
	return Vector2i(-1, -1)


## Compares two canonical states and reports the first differing path.
func check_same_state(a: GameState, b: GameState, msg: String) -> void:
	checks += 1
	var da = Ser.normalize_numbers(a.to_dict())
	var db = Ser.normalize_numbers(b.to_dict())
	var diff := _diff(da, db, "")
	if diff != "":
		failures.append("%s: first difference at %s" % [msg, diff])


func _diff(x, y, path: String) -> String:
	if typeof(x) != typeof(y):
		return "%s (type %d vs %d)" % [path, typeof(x), typeof(y)]
	if typeof(x) == TYPE_DICTIONARY:
		var keys: Array = x.keys()
		for k in y.keys():
			if not keys.has(k):
				keys.append(k)
		keys.sort()
		for k in keys:
			if not x.has(k) or not y.has(k):
				return "%s/%s (missing)" % [path, k]
			var d := _diff(x[k], y[k], path + "/" + str(k))
			if d != "":
				return d
		return ""
	if typeof(x) == TYPE_ARRAY:
		if x.size() != y.size():
			return "%s (size %d vs %d)" % [path, x.size(), y.size()]
		for i in range(x.size()):
			var d2 := _diff(x[i], y[i], "%s[%d]" % [path, i])
			if d2 != "":
				return d2
		return ""
	if x != y:
		return "%s (%s vs %s)" % [path, str(x).left(60), str(y).left(60)]
	return ""
