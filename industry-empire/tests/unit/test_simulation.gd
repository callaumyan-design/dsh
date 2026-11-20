extends "res://tests/test_case.gd"


func test_same_seed_same_world() -> void:
	var a := new_state(42)
	var b := new_state(42)
	all_ai(a)
	all_ai(b)
	run_weeks(a, 40)
	run_weeks(b, 40)
	check_same_state(a, b, "identical seed + actions => identical world")
	var c := new_state(43)
	all_ai(c)
	run_weeks(c, 40)
	check(c.fingerprint() != a.fingerprint(), "different seed diverges")


func test_long_run_has_no_illegal_state() -> void:
	for seed_v in [1, 2, 3]:
		var s := new_state(seed_v)
		all_ai(s)
		for w in range(60):
			if not s.game_over.is_empty():
				break
			TurnSystem.advance(s)
			var probs := TurnSystem.validate(s)
			check(probs.is_empty(), "seed %d week %d: %s" % [seed_v, s.turn, str(probs)])
			for n in s.nations.values():
				check(not is_nan(n.treasury), "treasury is a number")
			for c in s.cities.values():
				check(c.pop >= 0.0 and c.satisfaction >= 0.0 and c.satisfaction <= 100.0, "city values in range")


func test_ai_money_and_goods_are_accounted() -> void:
	var s := new_state(8)
	all_ai(s)
	var t0 := {}
	for nid in ["aster", "veld"]:
		t0[nid] = s.nations[nid].treasury
	var nets := {"aster": 0.0, "veld": 0.0}
	for w in range(40):
		run_weeks(s, 1)
		for nid in nets.keys():
			nets[nid] += float(s.nations[nid].finance["net"])
	for nid in nets.keys():
		check_near(s.nations[nid].treasury - t0[nid], nets[nid], 0.01, "%s money change fully explained by finance reports" % nid)
	var legit := ["production", "rural", "market_buy", "refund", "transport_in", "captured_in", "army_supply_in"]
	for nid in ["veld"]:
		for reason in s.nations[nid].ledger.keys():
			for r in s.nations[nid].ledger[reason].keys():
				if float(s.nations[nid].ledger[reason][r]) > 0.0001:
					check(reason in legit, "AI gained %s only via rules (reason %s)" % [r, reason])


func test_ai_develops_alone() -> void:
	var s := new_state(9)
	no_ai(s)
	s.nations["veld"].is_ai = true
	var c: City = s.cities["city_veld"]
	var b0: float = c.buildings.size()
	var pop0: float = c.pop
	var ind0: float = EconomySystem.industry_index(s, "veld")
	run_weeks(s, 40)
	check(c.buildings.size() > b0 + 5, "AI keeps building (%d -> %d)" % [b0, c.buildings.size()])
	check(c.pop > pop0 * 1.3, "AI city grows (%.0f -> %.0f)" % [pop0, c.pop])
	check(EconomySystem.industry_index(s, "veld") > ind0, "AI industry grows")
	check(s.nations["veld"].techs.size() >= 1, "AI researches")
	check(c.count_type("steel_mill") >= 1, "AI builds heavy industry")
	check(s.nations["veld"].treasury > -100.0, "AI stays solvent")


func test_ai_attacks_a_defenceless_player() -> void:
	var s := new_state(10)
	no_ai(s)
	s.nations["veld"].is_ai = true
	# the passive player disbands their army
	for a in s.armies_of("aster"):
		MilitarySystem.remove_army(s, a)
	run_weeks(s, 70)
	var attacked := false
	for e in s.events:
		if e["type"] == "war" and e["text"].contains("宣战"):
			attacked = true
	check(attacked, "AI exploits a defenceless rival")


func test_full_game_reaches_an_end() -> void:
	var s := new_state(12)
	all_ai(s)
	var weeks := 0
	while s.game_over.is_empty() and weeks < 400:
		TurnSystem.advance(s)
		weeks += 1
	check(not s.game_over.is_empty(), "AI vs AI game ends with a result within 400 weeks")
	check(s.game_over.get("type", "") in ["military", "economic", "hegemony", "collapse"], "valid end type")
	var r := TurnSystem.advance(s)
	check(not r["ok"], "no turns after the end")
