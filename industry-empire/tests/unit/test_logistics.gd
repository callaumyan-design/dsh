extends "res://tests/test_case.gd"


func _clear_natives(s: GameState, pid: String) -> void:
	for a in s.armies_in(pid):
		MilitarySystem.remove_army(s, a)


## Spec example: the factory city produces plenty of arms, but the only road to
## the front carries 6 goods per week — the front army is under-supplied.
func test_front_supply_limited_by_road_capacity() -> void:
	var s := new_state()
	no_ai(s)
	_clear_natives(s, "p4")
	var p4: Province = s.provinces["p4"]
	p4.owner = "aster"
	p4.controller = "aster"
	set_stock(s, "p4", {})
	# isolate the front: only the p1–p4 road (capacity 6) can carry goods
	s.provinces["p2"].controller = "veld"
	s.provinces["p3"].controller = "veld"
	WorldMapSystem.edge(s, "p1", "p4")["capacity"] = 6.0
	set_stock(s, "p1", {"food": 200.0, "arms": 100.0, "wood": 50, "stone": 50})
	var a := MilitarySystem.create_army(s, "aster", "p4", "前线军")
	a.units = {"infantry": 20.0}
	a.morale = 1.0
	a.supply = {"food": 0.0, "arms": 0.0}
	LogisticsSystem.run(s)
	var delivered: float = float(a.supply["food"]) + float(a.supply["arms"])
	check(delivered <= 6.0 + 0.0001, "deliveries respect edge capacity (%.2f)" % delivered)
	check(delivered > 5.9, "capacity is fully used (%.2f)" % delivered)
	var need := a.weekly_need()
	check(delivered < need["food"] + need["arms"], "front needs more than the road carries")
	MilitarySystem.run_supply(s)
	check(float(a.supply_ratio["food"]) < 1.0, "army is short of food")
	var starving := CombatSystem.side_factors(s, [a], "p4", false, 0.0)
	var fed := MilitarySystem.create_army(s, "aster", "p1", "后方军")
	fed.units = {"infantry": 20.0}
	fed.morale = 1.0
	var full := CombatSystem.side_factors(s, [fed], "p4", false, 0.0)
	check(starving["fire"] < full["fire"], "under-supplied army hits weaker")


func test_transport_tech_raises_capacity() -> void:
	var s := new_state()
	var e := WorldMapSystem.edge(s, "p1", "p2")
	var before: float = LogisticsSystem.edge_capacity(s, "aster", e)
	TechnologySystem.complete(s, s.nations["aster"], "transport")
	check_near(LogisticsSystem.edge_capacity(s, "aster", e), before * 1.4, 0.0001, "transport tech +40% capacity")


func test_blockade_cuts_route() -> void:
	var s := new_state()
	no_ai(s)
	s.wars.append({"id": 99, "attacker": "veld", "defender": "aster", "goal": "p1", "start": 0, "battle_score": 0.0, "score": 0.0, "battles": 0})
	var enemy := MilitarySystem.create_army(s, "veld", "p1", "围城军")
	enemy.units = {"infantry": 3.0}
	check(LogisticsSystem.blockaded(s, "aster", "p1"), "enemy army blockades the capital")
	check(not LogisticsSystem.node_ok(s, "aster", "p1"), "blockaded node unusable for transport")
	check_near(LogisticsSystem.route_capacity(s, "aster", "p3", "p2"), 0.0, 0.0001, "p3→p2 only went through p1: cut")


func test_rural_goods_flow_to_capital() -> void:
	var s := new_state()
	no_ai(s)
	set_stock(s, "p3", {"wood": 30.0})
	var w1: float = s.provinces["p1"].get_stock("wood")
	LogisticsSystem.run(s)
	var moved: float = s.provinces["p1"].get_stock("wood") - w1
	check(moved > 0.0, "wood moved from the countryside to the capital")
	check(moved <= LogisticsSystem.edge_capacity(s, "aster", WorldMapSystem.edge(s, "p1", "p3")) + 0.0001, "limited by road capacity")
	var log: Array = s.transport_log["aster"]
	check(not log.is_empty(), "shipments are logged for the UI")
