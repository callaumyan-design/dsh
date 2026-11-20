extends "res://tests/test_case.gd"


## Places a complete, connected steel mill (with access road) in Aster's city.
func _add_mill(s: GameState) -> Building:
	var c: City = s.cities["city_aster"]
	var site := CitySystem.find_site(c, "steel_mill", 8)
	check(not site.is_empty(), "found a steel mill site")
	for cell in site["road"]:
		CitySystem.place(c, "road", cell.x, cell.y, 0, 0, 0)
	var b := CitySystem.place(c, "steel_mill", site["x"], site["y"], site["rot"], 0, 0)
	CitySystem.refresh_connectivity(c)
	check(CitySystem.building_connected(c, b.id), "mill connected")
	return b


func test_production_limited_by_inputs() -> void:
	var s := new_state()
	no_ai(s)
	var mill := _add_mill(s)
	set_stock(s, "p1", {"coal": 1.0, "iron": 10.0})
	EconomySystem.produce_city(s, s.cities["city_aster"])
	var p: Province = s.provinces["p1"]
	check(mill.workers == 20, "mill fully staffed (%d)" % mill.workers)
	check_near(float(mill.last_out.get("steel", 0.0)), 1.0, 0.0001, "1 coal makes exactly 1 steel")
	check_near(float(mill.last_in.get("iron", 0.0)), 1.0, 0.0001, "iron consumed in recipe proportion")
	check_near(p.get_stock("coal"), 0.0, 0.0001, "all coal used, none negative")
	check_near(p.get_stock("iron"), 9.0, 0.0001, "iron left")
	check(mill.status.contains("缺少煤炭"), "status names the missing input: " + mill.status)


func test_no_inputs_no_output() -> void:
	var s := new_state()
	no_ai(s)
	var mill := _add_mill(s)
	set_stock(s, "p1", {})
	EconomySystem.produce_city(s, s.cities["city_aster"])
	check_near(float(mill.last_out.get("steel", 0.0)), 0.0, 0.0, "no steel from nothing")
	check_near(s.provinces["p1"].get_stock("steel"), 0.0, 0.0, "stock still zero")
	for r in GameData.RESOURCE_IDS:
		check(s.provinces["p1"].get_stock(r) >= 0.0, "non-negative " + r)


func test_storage_cap_limits_output() -> void:
	var s := new_state()
	no_ai(s)
	var p: Province = s.provinces["p1"]
	var cap := EconomySystem.storage_cap(s, p)
	set_stock(s, "p1", {"stone": cap - 0.5})
	EconomySystem.produce_city(s, s.cities["city_aster"])
	check(p.get_stock("stone") <= cap + 0.0001, "stone never exceeds storage cap")
	check_near(p.get_stock("stone"), cap, 0.0001, "filled to cap")


func test_tech_changes_farm_output() -> void:
	var s := new_state()
	no_ai(s)
	var c: City = s.cities["city_aster"]
	var farm := c.building_at(3, 15)
	set_stock(s, "p1", {})
	EconomySystem.produce_city(s, c)
	var base: float = float(farm.last_out["grain"])
	TechnologySystem.complete(s, s.nations["aster"], "agri_improve")
	set_stock(s, "p1", {})
	EconomySystem.produce_city(s, c)
	check_near(float(farm.last_out["grain"]), base * 1.25, 0.0001, "agri tech gives +25% farm output")


func test_steel_eff_tech_halves_coal() -> void:
	var s := new_state()
	no_ai(s)
	var mill := _add_mill(s)
	TechnologySystem.complete(s, s.nations["aster"], "steel_eff")
	set_stock(s, "p1", {"coal": 10.0, "iron": 10.0})
	EconomySystem.produce_city(s, s.cities["city_aster"])
	check_near(float(mill.last_in["coal"]), 1.0, 0.0001, "coal per week halved")
	check_near(float(mill.last_out["steel"]), 2.0, 0.0001, "steel output unchanged")


func test_food_shortage_hurts_population() -> void:
	var s := new_state()
	no_ai(s)
	var c: City = s.cities["city_aster"]
	for b in c.buildings.values():
		if b.type == "food_workshop":
			b.enabled = false
	set_stock(s, "p1", {})
	for pid in ["p2", "p3"]:
		set_stock(s, pid, {})
	var pop0: float = c.pop
	var sat0: float = c.satisfaction
	run_weeks(s, 3)
	check(c.pop < pop0, "population falls when starving (%.1f -> %.1f)" % [pop0, c.pop])
	check(c.satisfaction < sat0, "satisfaction falls when starving")


func test_world_goods_conservation() -> void:
	var s := new_state(11)
	all_ai(s)
	var start := s.world_goods_total()
	run_weeks(s, 30)
	var now := s.world_goods_total()
	var led := s.world_ledger_total()
	for r in GameData.RESOURCE_IDS:
		check_near(now[r] - start[r], led[r], 0.01, "goods change explained by ledger for " + r)
	# only legitimate sources create goods
	var sources := ["production", "rural", "market_buy", "refund", "transport_in", "army_supply_in", "captured_in"]
	for reason in s.world_ledger.keys():
		for r in s.world_ledger[reason].keys():
			if float(s.world_ledger[reason][r]) > 0.0001:
				check(reason in sources, "positive ledger entry only from legitimate source: %s/%s" % [reason, r])


func test_recipes_respected_every_week() -> void:
	var s := new_state(5)
	all_ai(s)
	for w in range(25):
		var techs_before := {}
		for nid0 in s.nation_order:
			techs_before[nid0] = s.nations[nid0].techs.size()
		run_weeks(s, 1)
		for c in s.cities.values():
			var nid: String = s.provinces[c.province_id].controller
			if s.nations[nid].techs.size() != techs_before[nid]:
				continue  # research finished after production this week
			for b in c.buildings.values():
				var d: Dictionary = b.def()
				if d["inputs"].is_empty() or b.last_out.is_empty():
					continue
				var unit_out := EconomySystem.output_amount(s, nid, b, 1.0)
				var unit_in := EconomySystem.input_need(s, nid, b, 1.0)
				var o: String = d["outputs"].keys()[0]
				var level := float(b.last_out[o]) / float(unit_out[o])
				for r in unit_in.keys():
					check_near(float(b.last_in.get(r, 0.0)), unit_in[r] * level, 0.0001,
						"week %d %s %s input matches output level" % [s.turn, b.type, r])


func test_bankruptcy_collapse() -> void:
	var s := new_state()
	no_ai(s)
	var n: Nation = s.nations["aster"]
	n.treasury = -5000.0
	n.debt_weeks = 15
	run_weeks(s, 1)
	check(not s.game_over.is_empty(), "long severe bankruptcy ends the game")
	check_eq(s.game_over.get("loser", ""), "aster", "bankrupt nation loses")
	check_eq(s.game_over.get("type", ""), "collapse", "collapse victory type")


func test_finance_report_balances() -> void:
	var s := new_state()
	no_ai(s)
	var n: Nation = s.nations["aster"]
	var m0: float = n.treasury
	run_weeks(s, 1)
	check_near(n.treasury - m0, float(n.finance["net"]), 0.0001, "treasury change equals reported net")
	check(n.finance["income"].has("tax_city"), "city tax in report")
	check(n.finance["expense"].has("upkeep_buildings"), "building upkeep in report")
	check(n.finance["expense"].has("upkeep_army"), "army upkeep in report")
