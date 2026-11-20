extends "res://tests/test_case.gd"


func _war(s: GameState, a: String, b: String) -> Dictionary:
	s.set_relation(a, b, 0.0)
	var r := DiplomacySystem.declare_war(s, a, b, s.nations[b].capital)
	check(r["ok"], "war declared: " + str(r))
	return r.get("war", {})


func test_unsupplied_army_weaker_and_attrition() -> void:
	var s := new_state()
	no_ai(s)
	var a := MilitarySystem.create_army(s, "aster", "p1", "甲")
	a.units = {"infantry": 5.0}
	a.morale = 1.0
	var b := MilitarySystem.create_army(s, "aster", "p1", "乙")
	b.units = {"infantry": 5.0}
	b.morale = 1.0
	b.supply_ratio = {"food": 0.0, "arms": 0.0}
	var fa := CombatSystem.side_factors(s, [a], "p4", false, 0.0)
	var fb := CombatSystem.side_factors(s, [b], "p4", false, 0.0)
	check(fb["fire"] < fa["fire"] * 0.6, "no food+arms cuts firepower (%.2f vs %.2f)" % [fb["fire"], fa["fire"]])
	check(fb["toughness"] < fa["toughness"], "hungry troops are less tough")
	# starvation attrition
	b.supply = {"food": 0.0, "arms": 0.0}
	var s0: float = b.total_strength()
	MilitarySystem.run_supply(s)
	check(b.total_strength() < s0, "starving army loses strength")


func test_movement_follows_adjacency_and_access() -> void:
	var s := new_state()
	no_ai(s)
	var a: Army = s.armies_in("p1", "aster")[0]
	var r := Commands.move_army(s, "aster", a.id, "p7")
	check(not r["ok"], "cannot march into a foreign nation in peacetime")
	r = Commands.move_army(s, "aster", a.id, "p5")
	check(r["ok"], "can march to native land")
	var prev := a.province
	for step in r["path"]:
		check(WorldMapSystem.are_adjacent(s, prev, step), "path step %s->%s adjacent" % [prev, step])
		prev = step
	# p1 -> p4 (plains, 1 week) or p2 (coastal 1 week) -> p5 hills (2 weeks): not instant
	MilitarySystem.run_movement(s)
	check(a.province != "p5", "cannot reach a non-adjacent province in one week")


func test_recruit_rules() -> void:
	var s := new_state()
	no_ai(s)
	var r := Commands.recruit(s, "aster", "p1", "infantry", 1)
	check(not r["ok"] and r["reason"].contains("兵营"), "infantry needs barracks")
	r = Commands.recruit(s, "aster", "p1", "militia", 1)
	check(r["ok"], "militia recruitable without barracks")
	var n: Nation = s.nations["aster"]
	n.treasury = 0.0
	r = Commands.recruit(s, "aster", "p1", "militia", 1)
	check(not r["ok"], "no money no recruits")
	r = Commands.recruit(s, "aster", "p7", "militia", 1)
	check(not r["ok"], "cannot recruit in foreign province")


func test_recruit_reduces_labor() -> void:
	var s := new_state()
	no_ai(s)
	var c: City = s.cities["city_aster"]
	var pop0: float = c.pop
	var arms0: float = s.provinces["p1"].get_stock("arms")
	Commands.recruit(s, "aster", "p1", "militia", 2)
	check(c.pop < pop0, "drafting soldiers lowers city population / labour")
	check_near(s.provinces["p1"].get_stock("arms"), arms0 - 2.0, 0.0001, "recruits consume arms")


func test_occupation_transfers_control() -> void:
	var s := new_state()
	no_ai(s)
	_war(s, "aster", "veld")
	for a in s.armies_in("p8"):
		MilitarySystem.remove_army(s, a)
	var army := MilitarySystem.create_army(s, "aster", "p8", "远征军")
	army.units = {"infantry": 6.0, "artillery": 2.0}
	army.morale = 1.0
	var p8: Province = s.provinces["p8"]
	set_stock(s, "p8", {"grain": 40.0})
	var weeks := 0
	while p8.controller != "aster" and weeks < 10:
		MilitarySystem.run_sieges(s)
		weeks += 1
	check_eq(p8.controller, "aster", "siege captured the province")
	check_eq(p8.owner, "veld", "ownership changes only by treaty")
	check_near(p8.get_stock("grain"), 20.0, 0.0001, "half of the stockpile destroyed, rest captured")
	check(p8.damage > 0.0, "war damage applied")
	check(not LogisticsSystem.node_ok(s, "veld", "p8"), "former owner cannot route goods through it")
	var tax_a: float = EconomySystem.tax_estimate(s, "aster")["rural"]
	check(tax_a > 0.0, "occupier collects (reduced) taxes")
	DiplomacySystem.update_war_scores(s)
	check(float(s.find_war("aster", "veld")["score"]) > 0.0, "occupation raises war score")


func test_battle_is_resolved_and_reported() -> void:
	var s := new_state(3)
	no_ai(s)
	_war(s, "aster", "veld")
	var att := MilitarySystem.create_army(s, "aster", "p4", "攻")
	att.units = {"infantry": 6.0}
	att.morale = 1.0
	att.arrived_turn = 0
	for a in s.armies_in("p4"):
		if a.nation == "natives":
			MilitarySystem.remove_army(s, a)
	var dfn := MilitarySystem.create_army(s, "veld", "p4", "守")
	dfn.units = {"militia": 2.0}
	dfn.morale = 0.7
	dfn.arrived_turn = -1
	CombatSystem.run(s)
	check(not s.battle_reports.is_empty(), "battle report written")
	var rep: Dictionary = s.battle_reports[-1]
	check(rep["rounds"].size() >= 1, "at least one round fought")
	check(float(rep["def_men_lost"]) > 0.0 and float(rep["att_men_lost"]) > 0.0, "both sides take losses")
	check_eq(rep["winner"], "aster", "6 infantry beat 2 militia")
	check(dfn.province != "p4" or dfn.is_empty() or not s.armies.has(dfn.id), "loser retreated or was destroyed")


func test_capital_capture_wins_war() -> void:
	var s := new_state()
	no_ai(s)
	var w := _war(s, "aster", "veld")
	var cap: Province = s.provinces["p7"]
	for a in s.armies_in("p7"):
		MilitarySystem.remove_army(s, a)
	MilitarySystem.occupy(s, cap, "aster")
	w["battle_score"] = 50.0
	DiplomacySystem.update_war_scores(s)
	VictorySystem.run(s)
	check_eq(s.game_over.get("winner", ""), "aster", "capturing the enemy capital forces capitulation")
	check_eq(s.game_over.get("type", ""), "military", "military victory")


func test_player_defeat_when_capital_held() -> void:
	var s := new_state()
	no_ai(s)
	_war(s, "veld", "aster")
	for a in s.armies_in("p1"):
		MilitarySystem.remove_army(s, a)
	MilitarySystem.occupy(s, s.provinces["p1"], "veld")
	var guard := MilitarySystem.create_army(s, "veld", "p1", "占领军")
	guard.units = {"infantry": 8.0}
	guard.morale = 1.0
	run_weeks(s, 4)
	check_eq(s.game_over.get("loser", ""), "aster", "losing the capital for weeks means defeat")
