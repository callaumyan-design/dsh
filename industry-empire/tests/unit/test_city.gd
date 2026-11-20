extends "res://tests/test_case.gd"


func test_placement_rules() -> void:
	var s := new_state()
	var c: City = s.cities["city_aster"]
	check(not CitySystem.can_place(c, "residence", 11, 9, 0)["ok"], "cannot overlap the warehouse")
	check(CitySystem.can_place(c, "residence", 11, 9, 0)["reason"].contains("重叠"), "overlap reason reported")
	check(not CitySystem.can_place(c, "residence", 23, 5, 0)["ok"], "2x2 at x=23 is out of bounds")
	check(not CitySystem.can_place(c, "residence", -1, 5, 0)["ok"], "negative coords out of bounds")
	check(not CitySystem.can_place(c, "road", 0, 5, 0)["ok"], "cannot build on water")
	check(not CitySystem.can_place(c, "residence", 21, 0, 0)["ok"], "cannot build on mountain")
	check(not CitySystem.can_place(c, "coal_mine", 4, 5, 0)["ok"], "coal mine needs a coal deposit")
	check(CitySystem.can_place(c, "coal_mine", 19, 12, 0)["ok"], "coal mine valid over deposit")
	check(not CitySystem.can_place(c, "farm", 15, 15, 0)["ok"], "farm cannot be on rock/quarry")


func test_rotation_changes_footprint() -> void:
	var s := new_state()
	var c: City = s.cities["city_aster"]
	check_eq(GameData.building_size("steel_mill", 0), Vector2i(3, 2), "steel mill 3x2")
	check_eq(GameData.building_size("steel_mill", 1), Vector2i(2, 3), "rotated steel mill 2x3")
	check_eq(CitySystem.normalize_rot("residence", 1), 0, "square non-rotatable ignores rotation")


func test_no_money_no_build() -> void:
	var s := new_state()
	no_ai(s)
	var n: Nation = s.nations["aster"]
	n.treasury = 5.0
	var c: City = s.cities["city_aster"]
	var p: Province = s.provinces["p1"]
	var wood_before: float = p.get_stock("wood")
	var spot := find_free_spot(c, "farm")
	var r := Commands.build(s, "aster", "city_aster", "farm", spot.x, spot.y, 0)
	check(not r["ok"], "build must fail without money")
	check(r["reason"].contains("金钱"), "reason mentions money")
	check_near(n.treasury, 5.0, 0.0001, "treasury unchanged")
	check_near(p.get_stock("wood"), wood_before, 0.0001, "wood unchanged")
	check(c.building_at(spot.x, spot.y) == null, "nothing placed")


func test_build_pays_and_undo_refunds() -> void:
	var s := new_state()
	no_ai(s)
	var n: Nation = s.nations["aster"]
	var c: City = s.cities["city_aster"]
	var p: Province = s.provinces["p1"]
	var m0: float = n.treasury
	var w0: float = p.get_stock("wood")
	var spot := find_free_spot(c, "farm")
	var r := Commands.build(s, "aster", "city_aster", "farm", spot.x, spot.y, 0)
	check(r["ok"], "farm build ok: " + str(r))
	check_near(n.treasury, m0 - 40.0, 0.001, "farm money cost paid")
	check_near(p.get_stock("wood"), w0 - 12.0, 0.001, "farm wood cost paid")
	check(c.buildings[r["building_id"]].build_left == 2, "construction takes 2 weeks")
	var u := Commands.undo_build(s, "aster", "city_aster")
	check(u["ok"], "undo ok")
	check_near(n.treasury, m0, 0.001, "money refunded")
	check_near(p.get_stock("wood"), w0, 0.001, "wood refunded")
	check(not c.buildings.has(r["building_id"]), "building removed")


func test_road_cut_disconnects_production() -> void:
	var s := new_state()
	no_ai(s)
	var c: City = s.cities["city_aster"]
	var quarry: Building = c.building_at(15, 15)
	check(quarry != null and quarry.type == "quarry", "scenario quarry present")
	check(CitySystem.building_connected(c, quarry.id), "quarry connected initially")
	run_weeks(s, 1)
	check(float(quarry.last_out.get("stone", 0.0)) > 0.0, "quarry produced stone while connected")
	var road := c.building_at(11, 14)
	check(road != null and road.type == "road", "road at 11,14")
	var r := Commands.demolish(s, "aster", "city_aster", road.id)
	check(r["ok"], "demolish road")
	check(not CitySystem.building_connected(c, quarry.id), "quarry disconnected after cutting road")
	var stone0: float = s.provinces["p1"].get_stock("stone")
	run_weeks(s, 1)
	check_near(float(quarry.last_out.get("stone", 0.0)), 0.0, 0.0001, "disconnected quarry produces nothing")
	check(quarry.status.contains("未连通"), "status explains disconnection: " + quarry.status)
	check_eq(quarry.workers, 0, "no workers assigned to disconnected building")
	# rebuild the road: production resumes
	Commands.build(s, "aster", "city_aster", "road", 11, 14, 0)
	check(CitySystem.building_connected(c, quarry.id), "reconnected")


func test_unconnected_housing_gives_no_capacity() -> void:
	var s := new_state()
	no_ai(s)
	var c: City = s.cities["city_aster"]
	var cap0: float = CitySystem.housing_capacity(c)
	# a residence far from any road
	var b := CitySystem.place(c, "residence", 4, 6, 0, 0, 0)
	check(not CitySystem.building_connected(c, b.id), "isolated residence not connected")
	check_near(CitySystem.housing_capacity(c), cap0, 0.001, "isolated residence adds no capacity")


func test_site_factor_fertile_farm() -> void:
	var s := new_state()
	var c: City = s.cities["city_aster"]
	var fertile := CitySystem.preview_site_factor(c, "farm", 6, 18, 0)
	var grass := CitySystem.preview_site_factor(c, "farm", 15, 1, 0)
	check(fertile > grass, "farm on fertile land (%.2f) beats grass (%.2f)" % [fertile, grass])
