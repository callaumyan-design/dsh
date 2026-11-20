class_name ScenarioLoader
extends RefCounted
## Builds a fresh GameState from scenario data.


static func build(s: GameState, scen: Dictionary, player: String, game_seed: int, difficulty_id: String) -> void:
	s.scenario_id = scen["id"]
	s.world_seed = game_seed
	s.rng.seed = game_seed
	s.turn = 0
	s.player_nation = player
	s.difficulty = difficulty_id
	for nd in scen["nations"]:
		var n := Nation.new()
		n.id = nd["id"]
		n.name = nd["name"]
		n.short_name = nd.get("short", n.name)
		n.color = Color.html(nd["color"])
		n.capital = nd.get("capital", "")
		n.is_native = bool(nd.get("native", false))
		n.is_ai = n.id != player
		n.personality = nd.get("personality", "industrialist")
		n.treasury = float(nd.get("treasury", 0))
		n.tax_policy = nd.get("tax_policy", "normal")
		n.research_funding = int(nd.get("research_funding", 1))
		s.nations[n.id] = n
		s.nation_order.append(n.id)
	for pd in scen["provinces"]:
		var p := Province.new()
		p.id = pd["id"]
		p.name = pd["name"]
		p.owner = pd["owner"]
		p.controller = p.owner
		p.terrain = pd["terrain"]
		p.pop = float(pd["pop"])
		p.base_pop = p.pop
		p.development = int(pd["development"])
		p.fort = int(pd.get("fort", 0))
		p.rural_output = Ser.float_dict(pd.get("rural_output", {}))
		p.deposits = Array(pd.get("deposits", []))
		p.city_id = pd.get("city", "")
		for r in GameData.RESOURCE_IDS:
			p.stock[r] = float(pd.get("stock", {}).get(r, 0.0))
		p.center = Ser.vec2(pd["center"])
		var poly := PackedVector2Array()
		for pt in pd["polygon"]:
			poly.append(Ser.vec2(pt))
		p.polygon = poly
		s.provinces[p.id] = p
		s.province_order.append(p.id)
	for e in scen["edges"]:
		s.edges.append({"a": e["a"], "b": e["b"], "capacity": float(e["capacity"])})
	for cd in scen["cities"]:
		var c := City.new()
		c.id = cd["id"]
		c.name = cd["name"]
		c.province_id = cd["province"]
		c.width = int(cd["size"][0])
		c.height = int(cd["size"][1])
		c.tiles = CitySystem.generate_tiles(cd)
		c.pop = float(cd["pop"])
		c.satisfaction = float(cd.get("satisfaction", 60))
		CitySystem.rebuild_occupancy(c)
		for seg in cd.get("roads", []):
			var x1 := int(seg[0])
			var y1 := int(seg[1])
			var x2 := int(seg[2])
			var y2 := int(seg[3])
			for y in range(min(y1, y2), max(y1, y2) + 1):
				for x in range(min(x1, x2), max(x1, x2) + 1):
					if c.building_at(x, y) == null and CitySystem.can_place(c, "road", x, y, 0)["ok"]:
						CitySystem.place(c, "road", x, y, 0, 0, 0)
		for bd in cd.get("buildings", []):
			var chk := CitySystem.can_place(c, bd["type"], int(bd["x"]), int(bd["y"]), int(bd.get("rot", 0)))
			if not chk["ok"]:
				push_error("Scenario building %s at %d,%d invalid: %s" % [bd["type"], int(bd["x"]), int(bd["y"]), chk["reason"]])
				continue
			CitySystem.place(c, bd["type"], int(bd["x"]), int(bd["y"]), int(bd.get("rot", 0)), 0, 0)
		s.cities[c.id] = c
	for ad in scen["armies"]:
		var a := Army.new()
		a.id = s.next_army_id
		s.next_army_id += 1
		a.nation = ad["nation"]
		a.name = ad["name"]
		a.province = ad["province"]
		for u in ad["units"].keys():
			a.units[u] = float(ad["units"][u])
		a.morale = MilitarySystem.max_morale(s, a)
		var need := a.weekly_need()
		var buf := GameData.balf("logistics.army_buffer_weeks", 2.0)
		a.supply = {"food": need["food"] * buf, "arms": need["arms"] * buf}
		s.armies[a.id] = a
	for rel in scen.get("relations", []):
		s.set_relation(rel[0], rel[1], float(rel[2]))
	s.rebuild_derived()
	EconomySystem.initialize(s)
	s.log_event("info", "%s：新的时代开始了。你统治着%s。" % [s.date_text(), s.nations[player].name], [player])
